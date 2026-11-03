-- Green Rich Hotel-Kyoto Eki Minami attendance system
-- Run once in Supabase SQL Editor. All times shown/grouped in Japan Standard Time.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'staff' check (role in ('staff','manager')),
  created_at timestamptz not null default now()
);

create table if not exists public.hotel_settings (
  id integer primary key default 1 check (id = 1),
  hotel_name text not null default 'Green Rich Hotel-Kyoto Eki Minami',
  latitude double precision,
  longitude double precision,
  geofence_radius_m integer not null default 200 check (geofence_radius_m between 25 and 1000),
  updated_at timestamptz not null default now()
);
insert into public.hotel_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.staff_shifts (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  shift_date date not null,
  shift_start_time time not null,
  shift_end_time time,
  created_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique(staff_id, shift_date)
);

create table if not exists public.attendance_events (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.profiles(id),
  action text not null check (action in ('clock_in','break_start','break_end','clock_out')),
  created_at timestamptz not null default now(),
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  is_voided boolean not null default false,
  is_manual boolean not null default false,
  correction_reason text,
  corrected_by uuid references public.profiles(id),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text
);
create index if not exists attendance_events_staff_time_idx on public.attendance_events(staff_id, created_at desc);
create index if not exists staff_shifts_date_idx on public.staff_shifts(shift_date, staff_id);

create or replace function public.is_attendance_manager()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='manager');
$$;

alter table public.profiles enable row level security;
alter table public.hotel_settings enable row level security;
alter table public.staff_shifts enable row level security;
alter table public.attendance_events enable row level security;

drop policy if exists "profile self or manager read" on public.profiles;
create policy "profile self or manager read" on public.profiles for select to authenticated
using (id=auth.uid() or public.is_attendance_manager());
drop policy if exists "settings authenticated read" on public.hotel_settings;
create policy "settings authenticated read" on public.hotel_settings for select to authenticated using (true);
drop policy if exists "staff own shifts or manager read" on public.staff_shifts;
create policy "staff own shifts or manager read" on public.staff_shifts for select to authenticated
using (staff_id=auth.uid() or public.is_attendance_manager());
drop policy if exists "staff own events or manager read" on public.attendance_events;
create policy "staff own events or manager read" on public.attendance_events for select to authenticated
using ((staff_id=auth.uid() or public.is_attendance_manager()));

-- Server validates GPS distance. Configure hotel latitude/longitude before staff rollout.
create or replace function public.attendance_action(p_action text,p_lat double precision,p_lng double precision,p_accuracy double precision default null)
returns public.attendance_events language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_last_action text; v_row public.attendance_events;
  v_settings public.hotel_settings; v_distance double precision;
  v_today date:=(now() at time zone 'Asia/Tokyo')::date;
begin
  if v_uid is null then raise exception 'Please sign in again.'; end if;
  if p_action not in ('clock_in','break_start','break_end','clock_out') then raise exception 'Invalid attendance action.'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Valid GPS location is required.'; end if;
  if not exists(select 1 from public.profiles where id=v_uid) then raise exception 'Staff profile not found. Contact your manager.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select * into v_settings from public.hotel_settings where id=1;
  if v_settings.latitude is null or v_settings.longitude is null then raise exception 'Hotel GPS coordinates are not configured yet. Contact your manager.'; end if;
  v_distance := 2 * 6371000 * asin(
    sqrt(
      power(sin(radians(p_lat - v_settings.latitude) / 2), 2)
      + cos(radians(v_settings.latitude))
      * cos(radians(p_lat))
      * power(sin(radians(p_lng - v_settings.longitude) / 2), 2)
    )
  );
  if v_distance > v_settings.geofence_radius_m then raise exception 'You are outside the hotel attendance area (% metres allowed).',v_settings.geofence_radius_m; end if;
  select action into v_last_action from public.attendance_events
    where staff_id=v_uid and not is_voided and (created_at at time zone 'Asia/Tokyo')::date=v_today
    order by created_at desc limit 1;
  if p_action='clock_in' and (v_last_action is not null and v_last_action<>'clock_out') then raise exception 'You already have an active attendance session.';
  elsif p_action='break_start' and (v_last_action is null or v_last_action not in ('clock_in','break_end')) then raise exception 'Break can only start while you are clocked in.';
  elsif p_action='break_end' and v_last_action<>'break_start' then raise exception 'There is no active break to end.';
  elsif p_action='clock_out' and (v_last_action is null or v_last_action not in ('clock_in','break_end')) then raise exception 'Clock out is only available after clock in or break end.';
  end if;
  insert into public.attendance_events(staff_id,action,latitude,longitude,accuracy_m)
  values(v_uid,p_action,p_lat,p_lng,p_accuracy) returning * into v_row;
  return v_row;
end; $$;

-- Manager can replace a mistaken punch. Original row remains in the database and is marked voided.
create or replace function public.manager_correct_event(p_event_id bigint,p_new_action text,p_new_time timestamptz,p_reason text)
returns public.attendance_events language plpgsql security definer set search_path=public as $$
declare v_old public.attendance_events; v_new public.attendance_events;
begin
  if auth.uid() is null or not public.is_attendance_manager() then raise exception 'Manager access required.'; end if;
  if p_new_action not in ('clock_in','break_start','break_end','clock_out') then raise exception 'Invalid action.'; end if;
  if p_reason is null or length(trim(p_reason))<5 then raise exception 'Please enter a correction reason (at least 5 characters).'; end if;
  select * into v_old from public.attendance_events where id=p_event_id and not is_voided for update;
  if not found then raise exception 'Original attendance record not found or already corrected.'; end if;
  update public.attendance_events set is_voided=true,voided_at=now(),voided_by=auth.uid(),void_reason=trim(p_reason) where id=p_event_id;
  insert into public.attendance_events(staff_id,action,created_at,latitude,longitude,accuracy_m,is_manual,correction_reason,corrected_by)
  values(v_old.staff_id,p_new_action,p_new_time,v_old.latitude,v_old.longitude,v_old.accuracy_m,true,trim(p_reason),auth.uid()) returning * into v_new;
  return v_new;
end; $$;

create or replace function public.manager_save_shift(p_staff_id uuid,p_shift_date date,p_start time,p_end time default null)
returns public.staff_shifts language plpgsql security definer set search_path=public as $$
declare v_row public.staff_shifts;
begin
  if auth.uid() is null or not public.is_attendance_manager() then raise exception 'Manager access required.'; end if;
  if not exists(select 1 from public.profiles where id=p_staff_id and role='staff') then raise exception 'Staff account not found.'; end if;
  insert into public.staff_shifts(staff_id,shift_date,shift_start_time,shift_end_time,created_by)
  values(p_staff_id,p_shift_date,p_start,p_end,auth.uid())
  on conflict(staff_id,shift_date) do update set shift_start_time=excluded.shift_start_time,shift_end_time=excluded.shift_end_time,created_by=auth.uid(),updated_at=now()
  returning * into v_row;
  return v_row;
end; $$;

revoke all on function public.attendance_action(text,double precision,double precision,double precision) from public;
revoke all on function public.manager_correct_event(bigint,text,timestamptz,text) from public;
revoke all on function public.manager_save_shift(uuid,date,time,time) from public;
grant execute on function public.attendance_action(text,double precision,double precision,double precision) to authenticated;
grant execute on function public.manager_correct_event(bigint,text,timestamptz,text) to authenticated;
grant execute on function public.manager_save_shift(uuid,date,time,time) to authenticated;
revoke insert,update,delete on public.attendance_events,public.staff_shifts,public.hotel_settings from anon,authenticated;
grant select on public.attendance_events,public.staff_shifts,public.hotel_settings,public.profiles to authenticated;

-- After creating Auth users, add profiles. Use the manager email supplied in app setup for the manager account.
-- insert into public.profiles(id,display_name,role) values ('AUTH-UUID','Manager','manager');
-- insert into public.profiles(id,display_name,role) values ('AUTH-UUID','Staff Name','staff');
-- Set hotel coordinates from the exact Google Maps pin for the staff entrance:
-- update public.hotel_settings set latitude=YOUR_LATITUDE, longitude=YOUR_LONGITUDE, geofence_radius_m=200 where id=1;
-- Assign each person's roster for each date using the Manager dashboard or manager_save_shift RPC.
