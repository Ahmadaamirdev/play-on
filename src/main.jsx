import React, { useState, useEffect, useId } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays, CreditCard, CircleHelp, ShieldCheck, Zap,
  UserRound,
  MapPin,
  Timer,
  Ticket, ArrowLeft, ChevronDown,
  Check,
  LogOut,
  CalendarCheck2,
  Sun,
  Warehouse,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  api,
  useData,
  time,
  fmt, bookingDateLabel,
  amount,
  Modal, ReceiptLink,
  Row,
  Entry,
  SportIcon,
  parseTime,
  PhoneInput,
  TimeInput,
} from "./shared";
import { courtTimeline, bookingTotal, closingTime, openingTime } from "../booking.js";
import "./admin.css";
import "./style.css";
import "./booking-receipt.css";
import { compressReceipt } from "./receipt-upload";
const Admin = React.lazy(() => import("./staff"));
function App() {
  const [cfg, setCfg] = useState(null),
    [err, setErr] = useState(""),
    [path, setPath] = useState(window.location.pathname),
    [auth, setAuth] = useState(false),
    [guide, setGuide] = useState(""),
    [staffTools, setStaffTools] = useState(null),
    [selection, setSelection] = useState({ sport: "Cricket", type: "Indoor" });
  const go = (next) => {
    if (window.location.pathname !== next)
      window.history.pushState({ playOnNavigation: true }, "", next);
    setPath(next);
    window.scrollTo(0, 0);
  };
  const load = async () => {
    const c = await api("/config");
    setCfg(c);
    return c;
  };
  useEffect(() => {
    load().catch((e) => setErr(e.message));
    const pop = () => {
      setAuth(false);
      setGuide("");
      setPath(window.location.pathname);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  if (!cfg)
    return (
      <main>
        <h1>Play On</h1>
        <p>{err || "Loading venue…"}</p>
      </main>
    );
  const staffPage = /^\/admin\/?$/.test(path),
    admin = cfg.user?.role === "admin",
    bookingsPage = /^\/my-bookings\/?$/.test(path);
  const playerConfig = admin ? { ...cfg, user: null } : cfg;
  const account = (staffPage ? cfg : playerConfig).user;
  const signed = async () => {
    await load();
    setAuth(false);
  };
  const signedOut = async () => {
    await api("/logout", {});
    await load();
    setAuth(false);
    if (!staffPage) go("/");
  };
  return (
    <>
      <header className={staffPage ? "ops-header" : "player-header"}>
        <div className="headinner">
          {!staffPage && (bookingsPage || window.history.state?.playOnNavigation) && <button className="icon" aria-label="Go back" onClick={() =>
            window.history.state?.playOnNavigation ? window.history.back() : go("/")}>
            <ArrowLeft />
          </button>}
          <a
            href={staffPage ? "/admin" : "/"}
            onClick={(e) => {
              e.preventDefault();
              go(staffPage ? "/admin" : "/");
            }}
            className="brand"
            aria-label="Play On home"
          >
            <i>≋</i>PLAY<span>ON</span>
          </a>
          {staffPage && <span className="ops-venue">{cfg.venue}</span>}
          {!staffPage && (
            <nav aria-label="Player navigation">
              <button
                aria-current={!bookingsPage ? "page" : undefined}
                className={!bookingsPage ? "navactive" : ""}
                onClick={() => go("/")}
              >
                <CalendarDays /> Book a court
              </button>
              <button
                aria-current={bookingsPage ? "page" : undefined}
                className={bookingsPage ? "navactive" : ""}
                onClick={() => go("/my-bookings")}
              >
                <Ticket /> My bookings
              </button>
              <button onClick={() => setGuide("Payments")}><CreditCard /> Payments</button>
              <button onClick={() => setGuide("Help")}><CircleHelp /> Help</button>
            </nav>
          )}
          {staffPage && admin && <div className="ops-tools" ref={setStaffTools} />}
          {(!staffPage || admin) && (
            <button className="userbtn" onClick={() => setAuth(true)}>
              <UserRound />
              {account?.name || "Sign in"}
            </button>
          )}
        </div>
      </header>
      <main className={staffPage ? "ops-main" : bookingsPage ? undefined : "player-home"}>
        {staffPage ? (
          admin ? (
            <React.Suspense fallback={null}><Admin cfg={cfg} reload={load} staffTools={staffTools} /></React.Suspense>
          ) : (
            <section className="panel staff-login">
              <h1>Staff sign in</h1>
              <Login staff done={signed} />
            </section>
          )
        ) : bookingsPage ? (
          <Mine key={playerConfig.user?.id || "guest"} cfg={playerConfig} sign={() => setAuth(true)} />
        ) : (
          <Player
            cfg={playerConfig}
            selection={selection}
            setSelection={setSelection}
            sign={() => setAuth(true)}
            toMine={() => go("/my-bookings")}
          />
        )}
      </main>
      {!staffPage && <footer>
        <b>{cfg.venue}</b>
        <span>
          {cfg.zone} · {cfg.currency}
        </span>
      </footer>}
      {guide && !staffPage && <Modal title={guide} close={() => setGuide("")}>
        {guide === "Payments" ? <>
          <p>{cfg.payment}</p>
          <p>Upload your receipt during checkout. After verification, download your payment slip from My bookings.</p>
          <button className="primary" onClick={() => { setGuide(""); go("/my-bookings"); }}>View my bookings</button>
        </> : <p>Choose a sport and court, then enter your date, start time and end time. Check the booked times below the form before continuing to payment.</p>}
      </Modal>}
      {auth && (
        <Modal
          title={account ? "Your account" : "Player sign in"}
          close={() => setAuth(false)}
        >
          {account ? (
            <>
              <p>{account.email}</p>
              <button className="primary" onClick={signedOut}>
                Sign out <LogOut />
              </button>
            </>
          ) : (
            <Login done={signed} />
          )}
        </Modal>
      )}
    </>
  );
}
function Login({ staff = false, done }) {
  const passwordId = useId();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [reg, R] = useState(false),
    [err, E] = useState(""),
    [busy, B] = useState(false);
  async function submit(body, path) {
    B(true);
    E("");
    try {
      await api(path, path === "/login" ? { ...body, staff } : body);
      await done();
    } catch (e) {
      E(e.message);
    } finally {
      B(false);
    }
  }
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(
            Object.fromEntries(new FormData(e.currentTarget)),
            reg ? "/register" : "/login",
          );
        }}
      >
        {reg && (
          <label>
            Full name
            <input name="name" required />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label htmlFor={passwordId}>Password</label>
        <div className="password-field">
          <input
            id={passwordId}
            name="password"
            type={passwordVisible ? "text" : "password"}
            minLength={reg ? 10 : 1}
            required
          />
          <button
            type="button"
            className="password-toggle"
            aria-label={passwordVisible ? "Hide password" : "Show password"}
            aria-controls={passwordId}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </div>
        <p role="alert">{err}</p>
        <button className="primary" disabled={busy}>
          {reg ? "Create account" : "Sign in"}
        </button>
      </form>
      {!staff && (
        <div className="inline">
          <button className="link" onClick={() => {
            R(!reg);
            E("");
            setPasswordVisible(false);
          }}>
            {reg ? "Sign in to an existing account" : "Create a player account"}
          </button>
          <a className="link" href="/admin">Staff sign in</a>
        </div>
      )}
    </>
  );
}
function Player({ cfg, selection, setSelection, sign, toMine }) {
  const { sport, type, date = cfg.today } = selection;
  const [startText, setStartText] = useState(""),
    [endText, setEndText] = useState(""),
    [startPeriod, setStartPeriod] = useState("AM"),
    [endPeriod, setEndPeriod] = useState("AM"),
    [rev, V] = useState(0),
    [modal, M] = useState(false),
    [hold, H] = useState(null),
    [err, E] = useState(""),
    [busy, B] = useState(false);
  const court = cfg.courts.find((c) => c.sport === sport && c.type === type),
    [availability, qerr] = useData(
      () =>
        api("/availability?" + new URLSearchParams({ court: court.id, date })),
      [court.id, date, rev],
      5000,
    );
  const schedule =
    availability?.court === court.id && availability.date === date
      ? availability
      : null;
  const availableSlots = schedule && !schedule.closed
    ? courtTimeline(schedule.booked, date > cfg.today ? openingTime : schedule.firstStart)
        .filter(slot => slot.state === "Available")
    : [];
  const start = parseTime(startText, startPeriod);
  const end = parseTime(endText, endPeriod, true);
  const validRange =
    start !== null && end !== null && start >= openingTime && end - start >= 60;
  let timeError = "";
  if (schedule?.closed) {
    timeError = "This court is closed on the selected date.";
  } else if ((startText && start === null) || (endText && end === null)) {
    timeError = "Enter a valid time, for example 4:30.";
  } else if (start !== null && schedule && start < schedule.firstStart) {
    timeError = "Choose a future start time.";
  } else if (startText && endText) {
    if (start === null || end === null) {
      timeError = "Enter hours and minutes, for example 4:30.";
    } else if (start < openingTime || end <= start) {
      timeError = "Choose an end time after the start within operating hours.";
    } else if (end - start < 60) {
      timeError = "Bookings must be at least 60 minutes.";
    } else if (schedule && start < schedule.firstStart) {
      timeError = "Choose a future start time.";
    } else if (
      schedule?.booked.some((slot) => slot.start < end && slot.end > start)
    ) {
      timeError = "This time overlaps an existing booking. Choose another range.";
    }
  }
  const ready = schedule && validRange && !timeError;
  const total =
    schedule && validRange ? bookingTotal(schedule.rate, end - start) : null;
  const pick = () => {
    if (!ready) {
      document.querySelector(start === null ? "#start-time" : "#end-time")?.focus();
      return;
    }
    if (!cfg.user) {
      sign();
      return;
    }
    E("");
    M(true);
  };
  async function begin(e) {
    e.preventDefault();
    if (!ready) return;
    B(true);
    try {
      const b = await api("/hold", {
        court: court.id,
        date,
        start,
        end,
        quotedTotal: total,
        ...Object.fromEntries(new FormData(e.currentTarget)),
      });
      H(b);
      M(false);
    } catch (e) {
      E(e.message);
      V((v) => v + 1);
    } finally {
      B(false);
    }
  }
  return (
    <>
      <section className="hero">
        <div>
          <span className="venue">
            <MapPin />
            {cfg.venue}
          </span>
          <h1>
            Book a Court<br />for <span>Your Game</span>
          </h1>
          <p>Cricket · Tennis · Padel　|　Indoor &amp; Outdoor Courts</p>
        </div>
        <div className="hero-perks"><span><CalendarDays /> Court reservations</span><span><Timer /> Live availability</span><span><ShieldCheck /> Verified payments</span></div>
      </section>
      <div className="layout">
        <div className="left">
          <section className="panel">
            <div className="sectiontitle">
              <span className="marker">01</span>
              <h2>Choose your sport</h2>
            </div>
            <div className="sportgrid">
              {["Cricket", "Tennis", "Padel"].map((s) => (
                <button
                  key={s}
                  aria-pressed={sport === s}
                  className={"sport " + (sport === s ? "chosen" : "")}
                  onClick={() => setSelection({ ...selection, sport: s })}
                >
                  <SportIcon sport={s} />
                  {s}
                  {s === sport && <Check className="tick" />}
                </button>
              ))}
            </div>
            <label>Court setting</label>
            <div className="switch">
              {["Indoor", "Outdoor"].map((t) => (
                <button
                  key={t}
                  aria-pressed={type === t}
                  className={type === t ? "pressed" : ""}
                  onClick={() => setSelection({ ...selection, type: t })}
                >
                  {t === "Indoor" ? <Warehouse /> : <Sun />}
                  {t}
                </button>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="sectiontitle">
              <span className="marker">02</span>
              <h2>Date & time</h2>
            </div>
            <label>
              Booking date
              <span className="booking-date-field">
                <span className="booking-date-display" aria-hidden="true">
                  {bookingDateLabel(date)} <ChevronDown size={16} />
                </span>
                <input
                  type="date"
                  value={date}
                  min={cfg.today}
                  onChange={(e) => {
                    if (e.target.value) setSelection({ ...selection, date: e.target.value });
                  }}
                />
              </span>
            </label>
            <div className="time-pair">
              <TimeInput
                id="start-time"
                value={startText}
                onChange={(e) => setStartText(e.target.value)}
                period={startPeriod}
                onPeriodChange={(e) => setStartPeriod(e.target.value)}
              />
              <TimeInput
                end
                id="end-time"
                value={endText}
                onChange={(e) => setEndText(e.target.value)}
                period={endPeriod}
                onPeriodChange={(e) => setEndPeriod(e.target.value)}
              />
            </div>
            <div className="between time-hint">
              <small id="time-format">
                Court hours are {time(openingTime)} – {time(closingTime)}. Minimum booking: 60 minutes.
              </small>
              <small>{cfg.zone}</small>
            </div>
            {ready && <button className="mobile-review" onClick={() => document.getElementById("booking-summary-title")?.focus()}>
              Review booking · {amount(total, cfg.currency)}
            </button>}
            {timeError && <p role="alert">{timeError}</p>}
            {qerr && <p role="alert">{qerr}</p>}
            {!schedule && !qerr && <p role="status">Checking availability…</p>}
            {schedule && !schedule.closed && (
              <div className="booked-times">
                <h3>{court.name} schedule</h3>
                {schedule.booked.length === 0 && <small>No bookings for this court on this date.</small>}
                <ul>
                  {schedule.booked.map((slot) => (
                    <li key={slot.start} data-state={slot.state}>
                      {time(slot.start)} – {time(slot.end)} · <strong>{slot.state}</strong>{slot.name && " · " + slot.name}
                    </li>
                  ))}
                </ul>
                {availableSlots.length > 0 && <>
                  <h4>Available time</h4>
                  <ul aria-label="Available time">
                    {availableSlots.map(slot => <li key={slot.start} data-state="Available">
                      {time(slot.start)} – {time(slot.end)} · <strong>Available</strong>
                    </li>)}
                  </ul>
                </>}
              </div>
            )}
          </section>
        </div>
        <aside className="panel summary">
          <div className="summaryhead">
            <Ticket />
            <h2 id="booking-summary-title" tabIndex={-1}>Booking summary</h2>
          </div>
          <div className="summbody">
            <div className="courtblock" data-court={court.id}>
              <span className="court-photo" aria-hidden="true" />
              <SportIcon sport={sport} />
              <div>
                <h3>{court.name}</h3>
                <small>{sport} · {type}</small>
              </div>
            </div>
            <Row k="Date">{fmt(date)}</Row>
            <Row k="Time">
              {validRange
                ? `${time(start)} – ${time(end)}`
                : "Enter start and end times"}
            </Row>
            <Row k="Hourly rate">
              {schedule ? amount(schedule.rate, cfg.currency) : "…"}
            </Row>
            <div className="total">
              <span>Total due</span>
              <strong>{total === null ? "…" : amount(total, cfg.currency)}</strong>
            </div>
            <button
              className="primary"
              data-ready={Boolean(ready)}
              onClick={pick}
              disabled={!schedule || Boolean(timeError)}
            >
              {ready ? "Continue to payment" : "Enter booking times"}
              <CalendarCheck2 />
            </button>

          </div>
        </aside>
      </div>
      <div className="booking-features">
        <div><Zap /><span><strong>Easy Booking</strong><span className="feature-description">Choose your own start and end times</span></span></div>
        <div><CalendarCheck2 /><span><strong>Flexible Options</strong><span className="feature-description">Indoor and outdoor courts for every sport</span></span></div>
        <div><ShieldCheck /><span><strong>Payment Receipts</strong><span className="feature-description">Download a slip after verification</span></span></div>
      </div>
      {modal && (
        <Modal title="Player details" close={() => M(false)}>
          <p>
            {court.name} · {fmt(date)} · {time(start)} – {time(end)}
            {total !== null && ` · ${amount(total, cfg.currency)}`}
          </p>
          <form onSubmit={begin}>
            <label>
              Full name
              <input
                name="name"
                defaultValue={cfg.user?.name}
                required
                maxLength="100"
              />
            </label>
            <label>
              Mobile number
              <PhoneInput />
            </label>
            <p role="alert">{err}</p>
            <button className="primary" disabled={busy || !ready}>
              Hold court & view payment details
            </button>
          </form>
        </Modal>
      )}
      {hold && (
        <Checkout
          b={hold}
          cfg={cfg}
          close={() => {
            H(null);
            V((v) => v + 1);
          }}
          done={toMine}
        />
      )}
    </>
  );
}
function Checkout({ b, cfg, close, done }) {
  const [err, E] = useState(""),
    [busy, B] = useState(false);
  return (
    <Modal title="Submit payment receipt" close={close}>
      <Row k="Amount due">{amount(b.total, cfg.currency)}</Row>
      <p>{cfg.payment}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          B(true);
          try {
            f.set("receipt", await compressReceipt(f.get("receipt")));
            await api("/bookings/" + b.id + "/receipt?date=" + b.date, f);
            done();
          } catch (e) {
            E(e.message);
          } finally {
            B(false);
          }
        }}
      >
        <label>
          Payment receipt · JPG, PNG or PDF (5 MB)
          <input
            required
            name="receipt"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
          />
        </label>
        <p role="alert">{err}</p>
        <button className="primary" disabled={busy}>
          {busy ? "Uploading receipt…" : "Submit for verification"}
        </button>
      </form>
    </Modal>
  );
}
function Mine({ cfg, sign }) {
  const [rev, R] = useState(0),
    [b, B] = useState(null);
  const [list, e] = useData(
    () => (cfg.user ? api("/mine") : Promise.resolve([])),
    [cfg.user?.id, rev], cfg.user ? 15000 : 0,
  );
  return (
    <>
      <h1>My bookings</h1>
      {!cfg.user ? (
        <button className="primary compact" onClick={sign}>
          Sign in to view bookings
        </button>
      ) : (
        <>
          <button onClick={() => R(rev + 1)}>Refresh bookings</button>
          {e && <p role="alert">{e}</p>}
          {!list && !e && <p role="status">Loading bookings…</p>}
          {list?.length === 0 && <p>Your court bookings will appear here.</p>}
          {list?.map((x) => (
            <Entry b={x} cfg={cfg} key={x.date + ":" + x.id + ":" + x.created}>
              {x.status === "Confirmed" && (
                <a
                  className="action"
                  href={"/api/bookings/" + x.id + "/invoice"}
                >
                  Download payment slip
                </a>
              )}
              {x.status === "Awaiting payment" && (
                <button onClick={() => B(x)}>Continue payment</button>
              )}
              {x.receipt && (
                <ReceiptLink booking={x}>View receipt</ReceiptLink>
              )}
              {x.reason && <p>Reason · {x.reason}</p>}
            </Entry>
          ))}
        </>
      )}
      {b && (
        <Checkout
          b={b}
          cfg={cfg}
          close={() => B(null)}
          done={() => {
            B(null);
            R(rev + 1);
          }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
