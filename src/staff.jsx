import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DateTime } from "luxon";
import {
  CalendarDays,
  ClipboardCheck,
  ScanLine,
  Banknote, Wallet, Download, CircleCheck, Gift, MoreHorizontal,
  Settings2,
  ChevronRight, ChevronLeft, Bell, Check, Crown, Hourglass, Clock3, MapPin,
  Users,
} from "lucide-react";
import {
  api,
  useData,
  time,
  fmt,
  amount,
  Modal, ReceiptLink, receiptURL,
  Badge,
  Row,
  Entry,
  parseTime,
  SportIcon,
  PhoneInput,
  TimeInput,
} from "./shared";

import { closingTime, openingTime } from "../booking.js";
const sports = ["Cricket", "Tennis", "Padel"],
  tabs = [
    ["Schedule", CalendarDays],
    ["Payments", ClipboardCheck],
    ["Check-in", ScanLine],
    ["Finance", Banknote],
    ["Players", Users],
    ["Rates", Settings2],
  ];
const data = (f) => Object.fromEntries(new FormData(f));
const cname = (cfg, id) => cfg.courts.find((c) => c.id === id)?.name;
function Court({ list, initial }) {
  return (
    <label>
      Court
      <select name="court" defaultValue={initial}>
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export default function Admin({ cfg, reload, staffTools }) {
  const [tab, T] = useState("Schedule"),
    [date, D] = useState(cfg.today),
    [rev, R] = useState(0),
    [msg, M] = useState("");
  const refresh = () => R((n) => n + 1);
  const [queue, queueError] = useData(() => api("/admin/queue"), [rev], 5000);
  const [menuOpen, setMenuOpen] = useState(false);
  const previousTabs = useRef([]);
  function chooseTab(next, remember = true) {
    if (remember && tab !== next) previousTabs.current.push(tab);
    T(next); M(""); setMenuOpen(false); window.scrollTo(0, 0);
  }
  const pendingCount = queue?.filter(b => b.status === "Pending verification").length ?? 0;

  return (
    <div className="admin-workspace">
      {staffTools && createPortal(
        <>{previousTabs.current.length > 0 && <button className="ops-bell" aria-label="Go back"
          onClick={() => chooseTab(previousTabs.current.pop(), false)}><ChevronLeft /></button>}
        <button className="ops-bell" aria-label={`Payment notifications, ${pendingCount} pending`}
          onClick={() => chooseTab("Payments")}>
          <Bell />{pendingCount > 0 && <i aria-hidden="true" />}
        </button></>, staffTools)}
      <aside className="ops-sidebar">
        <h1>Venue operations</h1>
        <button className="staff-menu-toggle" aria-controls="staff-navigation" aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}>Sections <strong>{tab}</strong><ChevronRight /></button>
        <nav id="staff-navigation" data-open={menuOpen} className="admintabs" aria-label="Staff navigation">
        {tabs.map(([v, I]) => (
          <button
            key={v}
            aria-pressed={tab === v}
            className={tab === v ? "pressed" : ""}
            aria-label={v === "Payments" && pendingCount
              ? `Payments, ${pendingCount} awaiting verification`
              : undefined}
            onClick={() => chooseTab(v)}
          >
            <I />
            {v}
            {v === "Payments" && pendingCount > 0 && (
              <span className="payment-count" aria-hidden="true">{pendingCount}</span>
            )}
          </button>
        ))}
        </nav>
        <small><MapPin size={14} /> {cfg.zone} · {cfg.currency}</small>
      </aside>
      <div className="ops-content">
      {msg && (
        <p role="status" className="notice">
          {msg}
        </p>
      )}
      {tab === "Schedule" ? (
        <Schedule {...{ cfg, date, D, rev, refresh, M }} />
      ) : tab === "Payments" ? (
        <Payments cfg={cfg} list={queue} err={queueError} refresh={refresh} M={M} />
      ) : tab === "Check-in" ? (
        <Checkin cfg={cfg} />
      ) : tab === "Finance" ? (
        <Finance cfg={cfg} rev={rev} date={date} />
      ) : tab === "Players" ? (
        <Players cfg={cfg} rev={rev} />
      ) : (
        <Rates cfg={cfg} reload={reload} M={M} />
      )}
      </div>
    </div>
  );
}
function Schedule({ cfg, date, D, rev, refresh, M }) {
  const [sport, S] = useState("All"),
    [court, C] = useState("All"),
    [modal, O] = useState(""),
    [err, E] = useState(""),
    [affected, F] = useState([]),
    [move, Q] = useState(null),
    [scope, K] = useState("All"),
    [busy, B] = useState(false),
    [viewMode, setViewMode] = useState("Day"); // Day | Month | Year
  const anchor = DateTime.fromISO(date, { zone: cfg.zone });

  // --- date range driven by viewMode (Day / Month / Year) ---
  const viewRange = {
    Day:   { from: date, to: date },
    Month: { from: anchor.startOf("month").toISODate(), to: anchor.endOf("month").toISODate() },
    Year:  { from: anchor.startOf("year").toISODate(),  to: anchor.endOf("year").toISODate()  },
  }[viewMode];

  // --- summary totals match the active viewMode date range ---
  const summaryQuery = "?" + new URLSearchParams({
    from: viewRange.from,
    to: viewRange.to,
  });
  const [summary, summaryError] = useData(async () => ({
    query: summaryQuery, rows: await api("/admin/booking-summary" + summaryQuery),
  }), [summaryQuery, rev], 5000);

  // For Day view fetch a single day; for Month/Year fetch the range
  const [d, e] = useData(
    () => viewMode === "Day" ? api("/admin/day?date=" + date) : Promise.resolve(null),
    [date, rev, viewMode], viewMode === "Day" ? 5000 : 0,
  );

  // Keep the last-loaded day data so the grid never disappears while navigating
  const lastDay = useRef(null);
  if (d) lastDay.current = d;
  const displayDay = lastDay.current;
  const isStale = displayDay && displayDay._id !== date; // fetching a new date

  // Multi-day bookings for Month / Year view (via finance slots)
  const [rangeData, rangeErr] = useData(
    () => viewMode !== "Day"
      ? api("/admin/finance?" + new URLSearchParams({
          from: viewRange.from, to: viewRange.to,
          basis: "booking", slots: "true",
          start: 360, end: 1440,
        }))
      : Promise.resolve(null),
    [viewMode, viewRange.from, viewRange.to, rev], 10000,
  );

  const lastRange = useRef(null);
  if (rangeData?.slots) lastRange.current = rangeData;
  const displayRange = rangeData || lastRange.current;
  const isRangeStale = viewMode !== "Day" && (!rangeData || rangeData !== lastRange.current);

  function open(v) { O(v); E(""); F([]); Q(null); }

  async function submit(f, kind) {
    B(true); E("");
    try {
      const v = data(f);
      if (kind === "move") {
        const start = parseTime(v.start, v.startPeriod);
        if (start === null) throw new Error("Enter hours and minutes, for example 4:30.");
        await api("/admin/move/" + move.id, { court: v.court, date: v.date, start });
        Q(null); F([]);
        M("Reservation moved. Recheck the closure scope.");
      } else if (kind === "VIP") {
        const start = parseTime(v.start, v.startPeriod);
        const end   = parseTime(v.end,   v.endPeriod, true);
        if (start === null || end === null)
          throw new Error("Enter hours and minutes for both times, for example 4:30.");
        await api("/admin/vip", {
          court: v.court, name: v.name, phone: v.phone,
          paymentType: v.paymentType, date, start, end,
        });
        O(""); M("VIP reservation saved.");
      } else {
        await api("/admin/closure", { date, scope });
        O(""); M("Closure applied.");
      }
      refresh();
    } catch (e) {
      E(e.message); F(e.affected || []);
    } finally { B(false); }
  }

  const visibleCourts = cfg.courts.filter(c =>
    (sport === "All" || sport === c.sport) && (court === "All" || court === c.id));

  // Day view bookings — use last loaded data while new date is fetching
  const current = displayDay?._id === date;
  const dayBookings = displayDay
    ? displayDay.bookings.filter(b =>
        visibleCourts.some(c => c.id === b.court) &&
        ["Confirmed", "VIP", "Pending verification", "Awaiting payment"].includes(b.status))
    : [];

  // Month / Year view: flat list from finance slots
  const rangeBookings = (displayRange?.slots ?? []).filter(b =>
    visibleCourts.some(c => c.id === b.court));

  // Booking-totals cards: calculate totals and keep last values so numbers never flash "—"
  const totals = { total: 0, confirmed: 0, vip: 0, pending: 0 };
  const lastTotals = useRef(totals);
  if (summary?.query === summaryQuery && !summaryError) {
    for (const row of summary?.rows ?? []) {
      if (visibleCourts.some(c => c.id === row._id)) {
        for (const key of Object.keys(totals)) totals[key] += row[key];
      }
    }
    lastTotals.current = totals;
  }
  const displayTotals = (summary?.query === summaryQuery && !summaryError)
    ? totals
    : lastTotals.current;
  const metrics = [
    ["Total Bookings", CalendarDays, "total"],
    ["Confirmed",      Check,        "confirmed"],
    ["VIP Bookings",   Crown,        "vip"],
    ["Pending / On Hold", Hourglass, "pending"],
  ];

  function shiftDate(n) {
    const unit = viewMode === "Month" ? "month" : viewMode === "Year" ? "year" : "day";
    D(DateTime.fromISO(date, { zone: cfg.zone }).plus({ [unit + "s"]: n }).toISODate());
  }

  // Label shown in the header subtitle
  const viewLabel =
    viewMode === "Month" ? anchor.toFormat("LLLL yyyy") :
    viewMode === "Year"  ? anchor.toFormat("yyyy") :
    fmt(date);

  return (
    <section className="panel schedule-board">
      {/* ── header: title only, no date picker here ── */}
      <div className="schedule-head">
        <div className="schedule-title">
          <CalendarDays />
          <div>
            <h2>Schedule</h2>
            <small>{viewLabel} · {cfg.zone}</small>
          </div>
        </div>
      </div>

      {/* ── booking totals cards ── */}
      {summaryError && <p role="alert">{summaryError}</p>}
      <div className="schedule-metrics">
        {metrics.map(([label, Icon, tone]) => (
          <div key={label} className={tone}>
            <Icon />
            <div>
              <strong>{displayTotals[tone]}</strong>
              <span>{label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── filters & court actions (now simple header, not a dropdown) ── */}
      <div className="schedule-controls">
        <div className="schedule-controls-head">
          <h3>Filters &amp; court actions</h3>
          {(sport !== "All" || court !== "All") && <small>· Filtered</small>}
        </div>
        <div className="filters">

          {/* Date navigation row */}
          <div className="filter-date-row">
            <button aria-label={"Previous " + viewMode.toLowerCase()} onClick={() => shiftDate(-1)}>
              <ChevronLeft />
            </button>
            <label className="filter-date-label">
              <CalendarDays />
              <span>{viewLabel}</span>
              <input
                aria-label="Date"
                type="date"
                value={date}
                onClick={e => e.currentTarget.showPicker?.()}
                onChange={e => e.target.value && D(e.target.value)}
              />
            </label>
            <button aria-label={"Next " + viewMode.toLowerCase()} onClick={() => shiftDate(1)}>
              <ChevronRight />
            </button>
          </div>

          {/* View-mode toggle: Day / Month / Year */}
          <div className="view-mode-toggle" role="group" aria-label="Schedule view">
            {["Day", "Month", "Year"].map(m => (
              <button
                key={m}
                className={viewMode === m ? "vm-active" : ""}
                aria-pressed={viewMode === m}
                onClick={() => setViewMode(m)}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Sport & Court selectors */}
          <label>
            Sport
            <select value={sport} onChange={e => { S(e.target.value); C("All"); }}>
              {["All", ...sports].map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Court
            <select value={court} onChange={e => C(e.target.value)}>
              <option>All</option>
              {cfg.courts
                .filter(c => sport === "All" || sport === c.sport)
                .map(c => <option value={c.id} key={c.id}>{c.name}</option>)}
            </select>
          </label>

          <div className="inline">
            <button onClick={() => open("Closure")}>Close courts</button>
            <button className="primary compact" onClick={() => open("VIP")}>Reserve for VIP</button>
          </div>
        </div>
      </div>
      {(e || rangeErr) && <p role="alert">{e || rangeErr}</p>}

      {/* ── DAY view ── */}
      {viewMode === "Day" && (
        <div className={"court-grid" + (isStale ? " court-grid--loading" : "")}>
          {displayDay && visibleCourts.map((c) => {
            const slots = dayBookings.filter(b => b.court === c.id).sort((a, b) => a.start - b.start);
            return (
              <div className="daycourt" data-court={c.id} key={c.id}>
                <h3><SportIcon sport={c.sport} />{c.name}</h3>
                {displayDay.closed.includes(c.id) ? (
                  <Badge v="Closed" />
                ) : slots.length === 0 ? (
                  <p className="scheduleline">No bookings.</p>
                ) : (
                  slots.map((b) => (
                    <div className="scheduleline" key={b.id}>
                      <span className="slot-time"><Clock3 />
                        {time(b.start)} – {time(b.start + b.duration)}
                      </span>
                      <strong>{b.name}{b.status === "VIP" && " · VIP"}</strong>
                      <Badge v={b.status} />
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── MONTH / YEAR view ── */}
      {viewMode !== "Day" && (
        <div className={"range-booking-list" + (isRangeStale ? " court-grid--loading" : "")}>
          {!displayRange && !rangeErr && <p className="scheduleline">Loading…</p>}
          {displayRange && rangeBookings.length === 0 && (
            <p className="scheduleline">No bookings in this {viewMode.toLowerCase()}.</p>
          )}
          {rangeBookings.map((b) => (
            <div className="scheduleline range-booking-row" key={b.id}>
              <span className="slot-time"><CalendarDays size={14} />
                {fmt(b.date)}
              </span>
              <span className="slot-time"><Clock3 size={14} />
                {time(b.start)} – {time(b.start + b.duration)}
              </span>
              <span className="slot-court">{cfg.courts.find(c => c.id === b.court)?.name}</span>
              <strong>{b.name}{b.status === "VIP" && " · VIP"}</strong>
              <Badge v={b.status} />
            </div>
          ))}
        </div>
      )}
      {modal && (
        <Modal
          title={
            move
              ? "Move reservation"
              : modal === "VIP"
                ? "VIP reservation"
                : "Close courts"
          }
          close={() => open("")}
        >
          <p>
            {fmt(date)} · {cfg.zone}
          </p>
          {move ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(e.currentTarget, "move");
              }}
            >
              <p>
                {move.id} · {move.name} · {move.duration} min
              </p>
              <Court
                list={cfg.courts.filter((c) => c.sport === move.sport)}
                initial={move.court}
              />
              <label>
                New booking date
                <input
                  type="date"
                  name="date"
                  defaultValue={move.date}
                  min={cfg.today}
                  required
                />
              </label>
              <TimeInput defaultTime={move.start} required />
              <small id="time-format">Enter hours and minutes, then select AM or PM.</small>
              <button disabled={busy} className="primary">
                Save new court & time
              </button>
            </form>
          ) : modal === "VIP" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(e.currentTarget, "VIP");
              }}
            >
              <Court list={cfg.courts} />
              <div className="time-pair">
                <TimeInput required />
                <TimeInput end required />
              </div>
              <small id="time-format">
                Court hours are {time(openingTime)} – {time(closingTime)}.
              </small>
              <label>
                Guest full name
                <input name="name" required />
              </label>
              <label>
                Guest mobile
                <PhoneInput />
              </label>
              <label>
                Payment
                <select name="paymentType">
                  <option>Paid</option>
                  <option>Complimentary</option>
                </select>
              </label>
              <button className="primary" disabled={busy}>
                Reserve court
              </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(e.currentTarget, "Closure");
              }}
            >
              <label>
                Closure applies to
                <select
                  value={scope}
                  onChange={(e) => {
                    K(e.target.value);
                    F([]);
                    E("");
                  }}
                >
                  <option value="All">All courts & sports</option>
                  {sports.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                  {cfg.courts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" disabled={busy}>
                Apply day closure
              </button>
            </form>
          )}
          {err && <p role="alert">{err}</p>}
          {!move &&
            affected.map((b) => (
              <Entry b={b} cfg={cfg} key={b.id}>
                <p>
                  {b.name} · {b.phone}
                </p>
                <button
                  onClick={() => {
                    Q(b);
                    E("");
                  }}
                >
                  Move reservation
                </button>
              </Entry>
            ))}
        </Modal>
      )}
    </section>
  );
}
function Payments({ cfg, list, err, refresh, M }) {
  const [b, B] = useState(null),
    [reason, R] = useState(""),
    [error, E] = useState(""),
    [busy, P] = useState(false);
  const [decision, setDecision] = useState(null);
  async function review(decision) {
    P(true);
    try {
      await api("/admin/review/" + b.id, { decision, reason });
      B(null);
      refresh();
      M(
        decision === "Approve"
          ? "Payment approved. Invoice available."
          : "Receipt rejected. Court released.",
      );
    } catch (e) {
      E(e.message);
    } finally {
      P(false);
    }
  }
  return (
    <section className="panel">
      <h2>Payment review queue</h2>
      <p>
        {err || (!list ? "Loading…" : list.filter(x => x.status === "Pending verification").length + " awaiting verification")}
      </p>
      {list?.map((x) => (
        <article className="ops-payment" key={x.id}>
          <div><b>{x.name}</b><small>{x.id} · {x.phone}</small></div>
          <div>{cname(cfg, x.court)}<small>{fmt(x.date)} · {time(x.start)} – {time(x.start + x.duration)}</small></div>
          <strong>{amount(x.total, cfg.currency)}</strong>
          <button onClick={() => { B(x); R(""); E(""); setDecision(null); }}>{x.status === "Awaiting payment" ? "Awaiting payment" : "Review payment"}</button>
        </article>
      ))}
      {b && (
        <Modal title="Review payment" close={() => { if (!busy) B(null); }}>
          <Entry b={b} cfg={cfg} />
          <p>
            {b.name} · {b.phone}
          </p>
          <Row k="Expected amount">{amount(b.total, cfg.currency)}</Row>
          {b.receipt && <>
            <ReceiptLink booking={b}>Open original receipt</ReceiptLink>
            <iframe title="Uploaded payment receipt" src={receiptURL(b)} />
          </>}
          <label>
            Reason for rejection
            <textarea
              value={reason}
              maxLength={300}
              onChange={(e) => R(e.target.value)}
            />
          </label>
          <p role="alert">{error}</p>
          {decision ? <div className="review-confirm" role="group" aria-label="Confirm payment decision">
            <p>{decision === "Approve" ? "Confirm payment of " + amount(b.total, cfg.currency) + " for " + b.name + "?" : "Reject this receipt and release the court for " + b.name + "?"}</p>
            <div className="inline"><button disabled={busy} onClick={() => setDecision(null)}>Go back</button>
              <button className="primary compact" disabled={busy || (decision === "Reject" && !reason.trim())}
                onClick={() => review(decision)}>{decision === "Approve" ? "Confirm approval" : "Confirm rejection"}</button></div>
          </div> : <div className="inline">
            <button
              disabled={busy || !reason.trim()}
              onClick={() => setDecision("Reject")}
            >
              Reject
            </button>
            <button
              className="primary compact"
              disabled={busy || b.status !== "Pending verification"}
              onClick={() => setDecision("Approve")}
            >
              Approve
            </button>
          </div>}
        </Modal>
      )}
    </section>
  );
}
function Checkin({ cfg }) {
  const [id, I] = useState(""),
    [b, B] = useState(null),
    [err, E] = useState("");
  return (
    <section className="panel narrow">
      <h2>Check-in lookup</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          E("");
          B(null);
          try {
            const code = id.trim().toUpperCase();
            const bookingId = code.startsWith("PO-") ? code : "PO-" + code;
            B(await api("/admin/check/" + encodeURIComponent(bookingId)));
          } catch (e) {
            E(e.message);
          }
        }}
      >
        <label>
          Booking ID
          <input
            value={id}
            onChange={(e) => {
              I(e.target.value);
              B(null);
            }}
            placeholder="PO-000001"
            required
          />
        </label>
        <button className="primary">Find booking</button>
      </form>
      {b && (
        <Entry b={b} cfg={cfg}>
          <h3>{b.name}</h3>
          <p>Confirm registered mobile · {b.phone}</p>
          {b.checked ? (
            <strong role="status">
              Already checked in ·{" "}
              {DateTime.fromMillis(b.checked, { zone: cfg.zone }).toFormat(
                "dd LLL, HH:mm",
              )}
            </strong>
          ) : (
            <button
              disabled={!["Confirmed", "VIP"].includes(b.status)}
              onClick={async () => {
                try {
                  B(await api("/admin/check/" + b.id, {}));
                } catch (e) {
                  E(e.message);
                }
              }}
            >
              Mark checked in
            </button>
          )}
        </Entry>
      )}
      <p role="alert">{err}</p>
    </section>
  );
}
function Rates({ cfg, reload, M }) {
  const [err, E] = useState("");
  return (
    <section className="panel narrow">
      <h2>Court hourly rates</h2>
      <p>
        Rates apply to new bookings. Existing quotes keep their original rate.
      </p>
      {cfg.courts.map((court) => (
        <form
          className="rateform"
          key={court.id}
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/admin/rates", {
                court: court.id,
                rate: +data(e.currentTarget).rate,
              });
              await reload();
              E("");
              M(court.name + " rate updated.");
            } catch (e) {
              E(e.message);
            }
          }}
        >
          <label>
            {court.name} · {cfg.currency} / hour
            <input
              type="number"
              min="1"
              max="1000000"
              required
              defaultValue={cfg.rates[court.id]}
              name="rate"
            />
          </label>
          <button>Save</button>
        </form>
      ))}
      <p role="alert">{err}</p>
    </section>
  );
}
function Players({ cfg, rev }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [players, searchError] = useData(
    () => api("/admin/players?" + new URLSearchParams({ q: query })), [query, rev],
  );
  const [result, profileError] = useData(
    () => selected ? api("/admin/players/" + selected) : Promise.resolve(null), [selected, rev],
  );
  return (
    <section className="panel">
      <h2>Players</h2>
      <label>
        Search by name or email
        <input type="search" value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {searchError && <p role="alert">{searchError}</p>}
      {players?.length === 0 && <p>No matching players.</p>}
      <div className="ops-directory">
        {players?.map((player) => (
          <button key={player._id} onClick={() => setSelected(player._id)}>
            <span><b>{player.name}</b><small>{player.email}</small></span>
            <ChevronRight aria-hidden="true" />
          </button>
        ))}
      </div>
      {selected && (
        <Modal title="Player profile" close={() => setSelected(null)}>
          {profileError && <p role="alert">{profileError}</p>}
          {result?.profile._id === selected && (
            <>
              <Row k="Name">{result.profile.name}</Row>
              <Row k="Email">{result.profile.email}</Row>
              <h3>Booking history</h3>
              {!result.bookings.length && <p>No bookings found.</p>}
              {result.bookings.map((b) => (
                <Entry cfg={cfg} b={b} key={b.id}><p>Booking mobile · {b.phone}</p></Entry>
              ))}
            </>
          )}
        </Modal>
      )}
    </section>
  );
}

function exportFinance(records, title, cfg) {
  const headers = ["Booking ID", "Player", "Sport", "Court", "Booking date", "Start", "End", "Amount (" + cfg.currency + ")", "Status"];
  const rows = records.map(b => [b.id, b.name, b.sport, cname(cfg, b.court), b.date,
    time(b.start), time(b.start + b.duration), b.total, title === "Payments" ? "Paid" : b.status]);
  const field = value => {
    const text = String(value ?? "");
    const safe = /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const csv = [headers, ...rows].map(row => row.map(field).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], {type:"text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = "play-on-" + title.toLowerCase().replaceAll(" ", "-") + ".csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function FinanceLedger({ records, cfg, slots, complimentary }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const term = search.trim().toLowerCase();
  const filtered = records.filter(b => [b.name, b.id, cname(cfg, b.court)]
    .some(value => value?.toLowerCase().includes(term)));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pages);
  const offset = (currentPage - 1) * 10;
  const title = slots ? "Booked slots" : complimentary ? "Complimentary visits" : "Payments";
  return <section className="finance-ledger" aria-label={title}>
    <div className="between">
      <h3>{title} <small>({filtered.length})</small></h3>
      <div className="finance-tools"><input type="search" aria-label="Search finance records" placeholder="Search player, booking ID or court"
        value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <button disabled={!filtered.length} onClick={() => exportFinance(filtered,title,cfg)}><Download /> Export</button></div>
    </div>
    {slots && <small>By booking date · Includes slots overlapping the selected hours.</small>}
    {filtered.length ? <div className="finance-table-scroll" tabIndex={0} aria-label={title + " table"}>
      <table><thead><tr>
        {["Booking ID","Player","Sport","Court","Date & time","Amount","Status","Details"].map(label => <th key={label}>{label}</th>)}
      </tr></thead><tbody>
        {filtered.slice(offset, offset + 10).map(b => <tr key={b.id}>
          <td data-label="Booking ID"><span className="finance-id">{b.id}</span></td>
          <td data-label="Player"><strong>{b.name}</strong></td>
          <td data-label="Sport">{b.sport}</td>
          <td data-label="Court">{cfg.courts.find(c => c.id === b.court)?.type}</td>
          <td data-label="Date & time">{fmt(b.date)}<small>{time(b.start)} – {time(b.start + b.duration)}</small></td>
          <td data-label="Amount"><strong>{amount(b.total, cfg.currency)}</strong></td>
          <td data-label="Status">{slots || complimentary ? <Badge v={b.status}/> : <span className="badge b-confirmed">Paid</span>}</td>
          <td><button className="finance-details" aria-label={"Booking details for " + b.id} onClick={() => setSelected(b)}><MoreHorizontal /></button></td>
        </tr>)}
      </tbody></table>
    </div> : <p role="status">{term ? "No records match your search." : slots ? "No matching booked slots." : "No matching records."}</p>}
    {selected && <Modal title="Booking details" close={() => setSelected(null)}>
      <Entry b={selected} cfg={cfg}/><Row k="Player">{selected.name}</Row>
      <Row k="Payment method">{selected.paymentType}</Row>
      {selected.verified && <Row k="Verified">{DateTime.fromMillis(selected.verified,{zone:cfg.zone}).toFormat("dd LLL yyyy, h:mm a")}</Row>}
    </Modal>}
    {pages > 1 && <div className="finance-pages">
      <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
      <small>Page {currentPage} of {pages}</small>
      <button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button>
    </div>}
  </section>;
}
function Finance({ cfg, rev, date }) {
  const [period, P] = useState("Last 7 days"),
    [setting, setSetting] = useState("Both"),
    [startTime, setStartTime] = useState("06:00"),
    [endTime, setEndTime] = useState("00:00"),
    [anchor, A] = useState(date),
    [end, T] = useState(date),
    [detail, F] = useState("All sports"),
    [view, setView] = useState("Payments");
  const unit = {
      Daily: "day",
      Weekly: "week",
      Monthly: "month",
      Yearly: "year",
    }[period],
    base = DateTime.fromISO(anchor, { zone: cfg.zone }),
    from = period === "Last 7 days" ? base.minus({days:6}).toISODate() : unit ? base.startOf(unit).toISODate() : anchor,
    to = period === "Last 7 days" ? anchor : unit ? base.endOf(unit).toISODate() : end;
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const start = startTime ? startHour * 60 + startMinute : openingTime;
  const endMinuteOfDay = endHour * 60 + endMinute || closingTime;
  const complimentary = view === "Complimentary";
  const showSlots = view === "Bookings revenue";
  const issue = from > to ? "Choose an end date on or after the start date."
    : start >= endMinuteOfDay ? "Choose an end time after the start time." : "";
  const query = new URLSearchParams({
    from, to, basis: "booking", setting, start, end: endMinuteOfDay, slots: true,
  }).toString();
  const [result, e] = useData(async () => {
    if (issue) return null;
    const previous = new URLSearchParams(query);
    const first = DateTime.fromISO(from, {zone:cfg.zone});
    const days = DateTime.fromISO(to, {zone:cfg.zone}).diff(first, "days").days + 1;
    previous.set("from", (unit ? first.minus({[unit]:1}) : first.minus({days})).toISODate());
    previous.set("to", first.minus({days:1}).toISODate());
    const [report, prior] = await Promise.all([query, previous].map(q => api("/admin/finance?" + q)));
    return {query, report, prior};
  }, [query, issue, rev, unit], 30000);
  const v = !issue && !e && result?.query === query ? result.report : null;
  const forSport = rows => rows.filter(b => detail === "All sports" || b.sport === detail);
  const records = v ? forSport(showSlots ? v.slots : complimentary ? v.complimentary : v.paid) : [];
  function figures(report) {
    return [detail === "All sports" ? report.total : report.breakdown[detail],
      forSport(report.slots).length, forSport(report.paid).length, forSport(report.complimentary).length];
  }
  const values = v && figures(v), prior = v && figures(result.prior);
  return (
    <section className="panel finance-panel">
      <div className="schedule-title"><Wallet /><div><h2>Finance</h2><small>Payments and revenue by booking date</small></div></div>
      <div className="finance-kpis">
        {[["Total revenue",Banknote],["Total bookings",CalendarDays],["Successful payments",CircleCheck],["Complimentary visits",Gift]].map(([label,Icon],i) => {
          const change = v && prior[i] > 0 ? Math.round((values[i] - prior[i]) / prior[i] * 100) : null;
          return <div key={label}><Icon /><div><small>{label}</small><strong>{v ? i === 0 ? amount(values[i],cfg.currency) : values[i] : "—"}</strong>
          {change !== null && <small title="Compared with the previous period">{change > 0 ? "+" : ""}{change}% vs. previous period</small>}</div></div>;
        })}
      </div>
      <div className="finance-switch" role="group" aria-label="Finance detail view">
        {["Payments","Bookings revenue"].map((name,i) => <button key={name} aria-pressed={view === name || (i === 0 && complimentary)}
          onClick={() => setView(name)}>{i ? <CalendarDays/> : <Banknote/>}{name}</button>)}
      </div>
      <div className="filters finance-toolbar">
        <label>
          Date range
          <select aria-label="Date range"
            value={period}
            onChange={(e) => {
              P(e.target.value);
              if (e.target.value === "Custom" && end < anchor) T(anchor);
            }}
          >
            {["Last 7 days", "Daily", "Weekly", "Monthly", "Yearly", "Custom"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>Sport<select aria-label="Sport" value={detail} onChange={e => F(e.target.value)}>
          {["All sports",...sports].map(name => <option key={name}>{name}</option>)}</select></label>
        <label>
          Court setting
          <select value={setting} onChange={(e) => setSetting(e.target.value)}>
            <option>Both</option><option>Indoor</option><option>Outdoor</option>
          </select>
        </label>
      </div>
      <details className="ops-filters" open={period === "Custom" ? true : undefined}>
        <summary>Date and time options · {fmt(from)}{from !== to && " – " + fmt(to)}</summary>
        <div className="filters">
        <label>
          {period !== "Custom" ? "Reference date" : "From"}
          <input
            type="date"
            value={anchor}
            onChange={(e) => e.target.value && A(e.target.value)}
          />
        </label>
        {period === "Custom" && (
          <label>
            Through
            <input
              type="date"
              value={end}
              min={anchor}
              onChange={(e) => e.target.value && T(e.target.value)}
            />
          </label>
        )}
        <label>Slot start time<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label>
        <label>Slot end time<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></label>
      </div>
      {!showSlots && <label className="finance-comp"><input type="checkbox" checked={complimentary}
        onChange={e => setView(e.target.checked ? "Complimentary" : "Payments")} /> Complimentary visits only</label>}
      </details>
      {(issue || e) && <p role="alert">{issue || e}</p>}
      {!issue && !e && !v && <p role="status">Loading report…</p>}
      {v && (
        <>
          <FinanceLedger key={[query, detail, view].join("|")} records={records} cfg={cfg}
            slots={showSlots} complimentary={complimentary} />
        </>
      )}
    </section>
  );
}
