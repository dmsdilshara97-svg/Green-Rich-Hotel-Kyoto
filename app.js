
// =====================================
// GREEN RICH HOTEL - STAFF ATTENDANCE
// =====================================

// Supabase configuration
const SUPABASE_URL = "https://brlznyvnwlkxifobmhja.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_XxD8yRrRjG4EqUT_nUFNTA_-YRQ6VqP";

const configured =
  !SUPABASE_URL.includes("YOUR-PROJECT") &&
  !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

const db = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let currentUser = null;
let profile = null;
let language = "en";
let allMonthEvents = [];
let allProfiles = [];
let todayShifts = [];

const $ = id => document.getElementById(id);

const labels = {
  clock_in: ["Clock In", "出勤"],
  break_start: ["Break Start", "休憩開始"],
  break_end: ["Break End", "休憩終了"],
  clock_out: ["Clock Out", "退勤"]
};

const fmtTime = v =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(v));

const fmtDate = v =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(v));

const jstToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const say = (id, msg, ok = false) => {
  $(id).textContent = msg;
  $(id).style.color = ok ? "#167447" : "#a53b36";
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

// =====================================
// LANGUAGE
// =====================================

function setLanguage() {
  document.documentElement.lang = language;

  document.querySelectorAll("[data-en]").forEach(el => {
    el.textContent = el.dataset[language];
  });

  $("langToggle").textContent =
    language === "en" ? "日本語" : "English";
}

$("langToggle").addEventListener("click", () => {
  language = language === "en" ? "ja" : "en";
  setLanguage();
});

// =====================================
// CLOCK
// =====================================

function tick() {
  $("liveClock").textContent =
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date());

  $("todayLabel").textContent =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tokyo",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(new Date()) + " · JST";
}

setInterval(tick, 1000);
tick();
setLanguage();

// =====================================
// SHOW APP
// =====================================

function showApp() {
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");

  $("welcomeName").textContent =
    profile.display_name || currentUser.email;

  $("roleLabel").textContent =
    profile.role === "manager"
      ? "MANAGER PORTAL"
      : "STAFF PORTAL";

  $("staffPanel").classList.toggle(
    "hidden",
    profile.role === "manager"
  );

  $("managerPanel").classList.toggle(
    "hidden",
    profile.role !== "manager"
  );

  if (profile.role === "manager") {
    loadManager();
  } else {
    loadMyEvents();
  }
}

// =====================================
// PROFILE
// =====================================

async function loadProfile() {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();

  if (error || !data) {
    await db.auth.signOut();

    say(
      "loginMessage",
      "Account profile not found. Ask your manager to finish account setup."
    );

    return;
  }

  profile = data;
  showApp();
}

// =====================================
// LOGIN
// =====================================

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!db) return;

  say("loginMessage", "Signing in…");

  const { data, error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });

  if (error) {
    say("loginMessage", error.message);
    return;
  }

  currentUser = data.user;
  await loadProfile();
});

// =====================================
// LOGOUT
// =====================================

$("logoutBtn").addEventListener("click", async () => {
  if (db) {
    await db.auth.signOut();
  }

  location.reload();
});

// =====================================
// GPS
// =====================================

async function getGPS() {
  if (!navigator.geolocation) {
    throw new Error("GPS is not supported on this device.");
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      p => resolve({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy
      }),
      e => reject(
        new Error(
          e.code === 1
            ? "Please allow location access to record attendance."
            : "Could not get GPS location. Please try again."
        )
      ),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  });
}

// =====================================
// STAFF ATTENDANCE ACTIONS
// =====================================

document.querySelectorAll("[data-action]").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (!db || btn.disabled) return;

    const action = btn.dataset.action;

    btn.disabled = true;
    say("staffMessage", "Getting GPS location…");

    try {
      const gps = await getGPS();

      const { data, error } = await db.rpc(
        "attendance_action",
        {
          p_action: action,
          p_lat: gps.lat,
          p_lng: gps.lng,
          p_accuracy: gps.accuracy
        }
      );

      if (error) throw error;

      say(
        "staffMessage",
        `${labels[action][0]} recorded at ${fmtTime(data.created_at)} (JST).`,
        true
      );

      await loadMyEvents();

    } catch (err) {
      say(
        "staffMessage",
        err.message || "Could not record attendance."
      );

    } finally {
      btn.disabled = false;
    }
  });
});

// =====================================
// STAFF TODAY RECORDS
// =====================================

async function loadMyEvents() {
  const { data, error } = await db
    .from("attendance_events")
    .select("*")
    .eq("staff_id", currentUser.id)
    .eq("is_voided", false)
    .gte("created_at", jstToday() + "T00:00:00+09:00")
    .order("created_at");

  if (error) {
    say("staffMessage", error.message);
    return;
  }

  renderMyEvents(data || []);
}

function renderMyEvents(events) {
  const box = $("myEvents");

  if (!events.length) {
    box.innerHTML = '<p class="muted">No records yet.</p>';

    $("statePill").textContent = "Not clocked in";
    $("statePill").className = "pill neutral";

    return;
  }

  box.innerHTML = events.map(e => `
    <div class="event">
      <span>${labels[e.action]?.[language === "en" ? 0 : 1] || e.action}</span>
      <time>${fmtTime(e.created_at)}</time>
    </div>
  `).join("");

  const last = events[events.length - 1].action;

  const states = {
    clock_in: ["Clocked in", "active"],
    break_start: ["On break", "breaking"],
    break_end: ["Clocked in", "active"],
    clock_out: ["Clocked out", "neutral"]
  };

  $("statePill").textContent = states[last][0];
  $("statePill").className = "pill " + states[last][1];

  document.querySelectorAll("[data-action]").forEach(b => {
    const a = b.dataset.action;

    b.disabled =
      (a === "clock_in" && last !== "clock_out") ||
      (a === "break_start" && last !== "clock_in" && last !== "break_end") ||
      (a === "break_end" && last !== "break_start") ||
      (a === "clock_out" && last !== "clock_in" && last !== "break_end");
  });
}

// =====================================
// MANAGER FILTERS
// =====================================

$("refreshBtn").addEventListener("click", loadManager);

$("monthFilter").value = jstToday().slice(0, 7);
$("monthFilter").addEventListener("change", loadMonth);
$("staffFilter").addEventListener("change", renderMonth);

// =====================================
// MANAGER DASHBOARD
// =====================================

async function loadManager() {
  say("managerMessage", "Loading dashboard…", true);

  const [p, e, sh] = await Promise.all([
    db.from("profiles")
      .select("id,display_name,role")
      .eq("role", "staff")
      .order("display_name"),

    db.from("attendance_events")
      .select("*")
      .eq("is_voided", false)
      .gte("created_at", jstToday() + "T00:00:00+09:00")
      .order("created_at"),

    db.from("staff_shifts")
      .select("*")
      .eq("shift_date", jstToday())
  ]);

  if (p.error || e.error || sh.error) {
    say(
      "managerMessage",
      p.error?.message || e.error?.message || sh.error?.message
    );

    return;
  }

  allProfiles = p.data || [];
  todayShifts = sh.data || [];

  const shiftSel = $("shiftStaff");

  shiftSel.innerHTML = allProfiles.map(x =>
    `<option value="${x.id}">${escapeHtml(x.display_name)}</option>`
  ).join("");

  $("shiftDate").value = jstToday();

  const sel = $("staffFilter");
  const old = sel.value;

  sel.innerHTML =
    '<option value="">All staff</option>' +
    allProfiles.map(x =>
      `<option value="${x.id}">${escapeHtml(x.display_name)}</option>`
    ).join("");

  sel.value = old;

  renderToday(e.data || [], todayShifts);

  await loadMonth();

  say("managerMessage", "Dashboard updated.", true);
}

// =====================================
// ATTENDANCE STATUS
// =====================================

function statusFor(events) {
  if (!events.length) return "Not clocked in";

  const last = events[events.length - 1].action;

  return last === "clock_in" || last === "break_end"
    ? "Clocked in"
    : last === "break_start"
      ? "On break"
      : "Clocked out";
}

// =====================================
// TODAY ATTENDANCE TABLE
// =====================================

function renderToday(events, shifts = []) {
  const by = {};

  events.forEach(e => {
    (by[e.staff_id] ??= []).push(e);
  });

  let counts = {
    "Clocked in": 0,
    "On break": 0,
    "Clocked out": 0,
    "Not clocked in": 0
  };

  let late = 0;

  $("todayRows").innerHTML = allProfiles.map(p => {
    const es = by[p.id] || [];
    const st = statusFor(es);

    counts[st]++;

    const first = es.find(x => x.action === "clock_in");

    const assigned = shifts.find(
      x => x.staff_id === p.id
    );

    if (first && assigned) {
      const actual = fmtTime(first.created_at).slice(0, 5);

      if (actual > assigned.shift_start_time.slice(0, 5)) {
        late++;
      }
    }

    const last = es[es.length - 1];

    const gps = last && last.latitude != null
      ? `<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${last.latitude},${last.longitude}">Map</a>`
      : "—";

    return `
      <tr>
        <td>${escapeHtml(p.display_name)}</td>
        <td class="status-text">${st}</td>
        <td>${first ? fmtTime(first.created_at) : "—"}</td>
        <td>${last ? labels[last.action][0] + " · " + fmtTime(last.created_at) : "—"}</td>
        <td>${gps}</td>
      </tr>
    `;
  }).join("") || '<tr><td colspan="5">No staff accounts configured.</td></tr>';

  $("statIn").textContent = counts["Clocked in"];
  $("statBreak").textContent = counts["On break"];
  $("statOut").textContent = counts["Clocked out"];
  $("statLate").textContent = late;
}

// =====================================
// MONTHLY RECORDS
// =====================================

async function loadMonth() {
  const month = $("monthFilter").value;

  if (!month) return;

  const start = month + "-01T00:00:00+09:00";

  const [y, m] = month.split("-").map(Number);

  const endDate = new Date(Date.UTC(y, m, 1));

  const end =
    `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00+09:00`;

  let q = db
    .from("attendance_events")
    .select("*")
    .eq("is_voided", false)
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at");

  if ($("staffFilter").value) {
    q = q.eq("staff_id", $("staffFilter").value);
  }

  const { data, error } = await q;

  if (error) {
    say("managerMessage", error.message);
    return;
  }

  allMonthEvents = data || [];

  renderMonth();
  renderCorrectionOptions();
}

function renderMonth() {
  const map = Object.fromEntries(
    allProfiles.map(p => [p.id, p.display_name])
  );

  $("monthRows").innerHTML = allMonthEvents.map(e => `
    <tr>
      <td>${fmtDate(e.created_at)}</td>
      <td>${escapeHtml(map[e.staff_id] || "Unknown")}</td>
      <td>${labels[e.action]?.[0] || e.action}${e.is_manual ? " · Corrected" : ""}</td>
      <td>${fmtTime(e.created_at)}</td>
      <td>${e.latitude != null
        ? `<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${e.latitude},${e.longitude}">Map</a>`
        : "—"}</td>
    </tr>
  `).join("") || '<tr><td colspan="5">No records for this month.</td></tr>';
}

// =====================================
// CORRECTION OPTIONS
// =====================================

function renderCorrectionOptions() {
  const names = Object.fromEntries(
    allProfiles.map(p => [p.id, p.display_name])
  );

  const sel = $("correctionEvent");

  if (!sel) return;

  sel.innerHTML = allMonthEvents.map(e => `
    <option value="${e.id}">
      ${escapeHtml(names[e.staff_id] || "Staff")} ·
      ${fmtDate(e.created_at)} ${fmtTime(e.created_at)} ·
      ${labels[e.action]?.[0] || e.action}
    </option>
  `).join("");

  if (!allMonthEvents.length) {
    sel.innerHTML =
      '<option value="">No records in selected month</option>';
  }
}

// =====================================
// SAVE INDIVIDUAL SHIFT
// =====================================

$("saveShiftBtn").addEventListener("click", async () => {
  const btn = $("saveShiftBtn");

  try {
    if (!db) {
      say("managerMessage", "Supabase is not connected.");
      return;
    }

    const staffId = $("shiftStaff").value;
    const date = $("shiftDate").value;
    const start = $("shiftStart").value;
    const end = $("shiftEnd").value;

    if (!staffId || !date || !start) {
      say("managerMessage", "Choose staff, date and shift start time.");
      return;
    }

    btn.disabled = true;

    say("managerMessage", "Saving individual shift...", true);

    const { data, error } = await db.rpc("manager_save_shift", {
      p_staff_id: staffId,
      p_shift_date: date,
      p_start: start,
      p_end: end || null
    });

    if (error) {
      console.error("Save Shift Error:", error);
      say("managerMessage", "Shift was not saved: " + error.message);
      return;
    }

    if (date === jstToday()) {
      await loadManager();
    }

    say("managerMessage", "Individual shift saved successfully.", true);

  } catch (err) {
    console.error("Unexpected error:", err);

    say(
      "managerMessage",
      "Unexpected error: " + (err.message || String(err))
    );

  } finally {
    btn.disabled = false;
  }
});

// =====================================
// AUTH SESSION
// =====================================

if (!configured) {
  $("setupNotice").classList.remove("hidden");
  $("loginForm").querySelector("button").disabled = true;

} else {
  db.auth.getSession().then(({ data }) => {
    if (data.session) {
      currentUser = data.session.user;
      loadProfile();
    }
  });

  db.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      currentUser = null;
      profile = null;

      $("appView").classList.add("hidden");
      $("loginView").classList.remove("hidden");
      $("logoutBtn").classList.add("hidden");
    }
  });
}

// =====================================
// MANAGER TEST MODE
// Test records are stored separately.
// =====================================

function ensureTestPanel() {
  if (document.getElementById("testModePanel")) return;

  const panel = document.createElement("section");

  panel.id = "testModePanel";

  panel.style.cssText =
    "margin:20px 0;padding:18px;border:2px dashed #d97706;border-radius:12px;background:#fffaf0;color:#222;";

  panel.innerHTML = `
    <h2>🧪 TEST MODE — Manager Only</h2>
    <p>Test records are separate from real attendance.</p>

    <label>Staff</label>
    <select id="testStaff"
      style="display:block;width:100%;padding:10px;margin:6px 0 12px;">
    </select>

    <label>Test Action</label>
    <select id="testAction"
      style="display:block;width:100%;padding:10px;margin:6px 0 12px;">
      <option value="clock_in">Clock In</option>
      <option value="break_start">Break Start</option>
      <option value="break_end">Break End</option>
      <option value="clock_out">Clock Out</option>
    </select>

    <label>Simulated Date & Time (Japan time)</label>
    <input id="testDateTime" type="datetime-local"
      style="display:block;width:100%;padding:10px;margin:6px 0 12px;">

    <button id="addTestEvent"
      style="padding:11px 18px;background:#d97706;color:white;border:0;border-radius:7px;">
      Add Test Event
    </button>

    <p id="testMessage" style="margin-top:12px;"></p>

    <button id="resetTestRecords"
      style="padding:11px 18px;background:#dc2626;color:white;border:0;border-radius:7px;margin-top:10px;">
      Reset Test Records
    </button>

    <h3>Test Late Attendance</h3>
    <p id="testLateCount">Loading...</p>

    <h3>Test Attendance Records</h3>
    <div id="testRecords">Loading...</div>
  `;

  $("managerPanel").prepend(panel);

  const now = new Date();

  const japanTime = new Date(
    now.toLocaleString("en-US", {
      timeZone: "Asia/Tokyo"
    })
  );

  const pad = n => String(n).padStart(2, "0");

  $("testDateTime").value =
    `${japanTime.getFullYear()}-${pad(japanTime.getMonth() + 1)}-${pad(japanTime.getDate())}T${pad(japanTime.getHours())}:${pad(japanTime.getMinutes())}`;

  $("testStaff").innerHTML = allProfiles.map(p =>
    `<option value="${p.id}">${escapeHtml(p.display_name)}</option>`
  ).join("");

  $("addTestEvent").addEventListener("click", addTestEvent);

  // Reset TEST records only
  $("resetTestRecords").addEventListener("click", async () => {
    const confirmed = confirm(
      "Are you sure you want to delete ALL test attendance records?"
    );

    if (!confirmed) return;

    $("resetTestRecords").disabled = true;
    $("testMessage").textContent = "Resetting test records...";

    try {
      const { data, error } = await db.rpc(
        "manager_reset_test_attendance"
      );

      if (error) throw error;

      $("testMessage").textContent =
        `${data} test records deleted successfully.`;

      await loadTestEvents();

    } catch (err) {
      $("testMessage").textContent =
        err.message || "Reset failed.";

    } finally {
      $("resetTestRecords").disabled = false;
    }
  });
}

// =====================================
// ADD TEST ATTENDANCE EVENT
// =====================================


async function addTestEvent() {
  const staffId = $("testStaff").value;
  const action = $("testAction").value;
  const rawTime = $("testDateTime").value;

  if (!staffId || !rawTime) {
    $("testMessage").textContent =
      "Please select staff and date/time.";
    return;
  }

  const eventTime = new Date(rawTime + ":00+09:00");

  if (Number.isNaN(eventTime.getTime())) {
    $("testMessage").textContent = "Invalid date/time.";
    return;
  }

  $("addTestEvent").disabled = true;
  $("testMessage").textContent = "Saving test record...";

  try {
    const { data, error } = await db.rpc(
      "manager_add_test_attendance",
      {
        p_staff_id: staffId,
        p_action: action,
        p_event_time: eventTime.toISOString()
      }
    );

    if (error) throw error;

    $("testMessage").textContent =
      "Test attendance saved successfully. ID: " + data;

    await loadTestEvents();

  } catch (err) {
    console.error("Test attendance error:", err);
    $("testMessage").textContent =
      err.message || "Could not save test record.";

  } finally {
    $("addTestEvent").disabled = false;
  }
}

// =====================================
// LOAD TEST ATTENDANCE
// =====================================

async function loadTestEvents() {
  const { data, error } = await db
    .from("test_attendance_events")
    .select("*")
    .order("event_time", { ascending: true });

  if (error) {
    $("testRecords").textContent = error.message;
    return;
  }

  const events = data || [];

  const names = Object.fromEntries(
    allProfiles.map(p => [p.id, p.display_name])
  );

  const shifts = todayShifts || [];
  let lateCount = 0;

  const todayEvents = events.filter(e =>
    new Date(e.event_time).toLocaleDateString("en-CA", {
      timeZone: "Asia/Tokyo"
    }) === jstToday()
  );

  allProfiles.forEach(p => {
    const staffEvents = todayEvents
      .filter(e => e.staff_id === p.id)
      .sort((a, b) =>
        new Date(a.event_time) - new Date(b.event_time)
      );

    const firstClockIn = staffEvents.find(
      e => e.action === "clock_in"
    );

    const shift = shifts.find(
      s => s.staff_id === p.id
    );

    if (firstClockIn && shift) {
      const actual = new Date(firstClockIn.event_time)
        .toLocaleTimeString("en-GB", {
          timeZone: "Asia/Tokyo",
          hour: "2-digit",
          minute: "2-digit"
        });

      if (actual > shift.shift_start_time.slice(0, 5)) {
        lateCount++;
      }
    }
  });

  $("testLateCount").textContent =
    lateCount + " staff late today (TEST)";

  $("testRecords").innerHTML = events.map(e => `
    <div style="padding:8px;border-bottom:1px solid #ddd;">
      <strong>${escapeHtml(names[e.staff_id] || "Unknown")}</strong>
      · ${labels[e.action]?.[0] || e.action}
      · ${fmtDate(e.event_time)}
      ${fmtTime(e.event_time)}
    </div>
  `).join("") || "No test records yet.";
}

// =====================================
// CONNECT TEST MODE TO MANAGER
// =====================================

const originalLoadManagerForTest = loadManager;

loadManager = async function() {
  await originalLoadManagerForTest();
  ensureTestPanel();
  await loadTestEvents();
};
