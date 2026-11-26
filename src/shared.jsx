import React, { useEffect, useId, useRef, useState } from "react";
import { DateTime } from "luxon";
import { ArrowLeft, FileText } from "lucide-react";
import { closingTime, time } from "../booking.js";
export { time };
export async function api(path, body, method) {
  const form = body instanceof FormData;
  const r = await fetch("/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body !== undefined && !form ? { "Content-Type": "application/json" } : {},
    body: form ? body : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Object.assign(Error(data.message), data);
  return data;
}
export function parseTime(value, period, end = false) {
  const match = /^(0?[1-9]|1[0-2]):([0-5][0-9])$/.exec(value.trim());
  if (!match || (period !== "AM" && period !== "PM")) return null;
  const [, hour, minute] = match;
  const minutes =
    (Number(hour) % 12) * 60 + Number(minute) + (period === "PM" ? 720 : 0);
  return end && minutes === 0 ? closingTime : minutes;
}

function formatTimeInput(value) {
  const cleaned = value.replace(/[^0-9:]/g, "");
  const colon = cleaned.indexOf(":");
  const digits = cleaned.replace(/:/g, "");
  if (!digits) return "";
  let hourLength = 1;
  if (colon > 0) hourLength = Math.min(colon, 2);
  else if (digits.length > 1 && Number(digits.slice(0, 2)) >= 1 && Number(digits.slice(0, 2)) <= 12)
    hourLength = 2;
  const hour = digits.slice(0, hourLength);
  if (Number(hour) > 12 || (hour.length === 2 && Number(hour) === 0)) return digits[0];
  let minutes = digits.slice(hourLength, hourLength + 2);
  if (minutes && Number(minutes[0]) > 5) minutes = "0" + minutes[0];
  if (!minutes && colon < 0) return hour;
  return hour + ":" + minutes;
}

export function TimeInput({
  end = false,
  id,
  defaultTime,
  value,
  onChange,
  period,
  onPeriodChange,
  required,
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const name = end ? "end" : "start";
  const label = end ? "End time" : "Start time";
  const [initialValue, initialPeriod = "AM"] =
    defaultTime === undefined ? [] : time(defaultTime).split(" ");

  return (
    <div className="time-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="time-control">
        <input
          id={inputId}
          name={name}
          type="text"
          inputMode="numeric"
          maxLength={5}
          pattern="(0?[1-9]|1[0-2]):[0-5][0-9]"
          title="Enter a valid time, for example 6:30"
          placeholder={end ? "7:30" : "6:00"}
          aria-describedby="time-format"
          spellCheck={false}
          autoComplete="off"
          value={value}
          defaultValue={value === undefined ? initialValue : undefined}
          onChange={(e) => {
            const input = e.target;
            const formatted = formatTimeInput(input.value);
            const completeHour = /^(?:[2-9]|0[1-9]|1[0-2])$/.test(formatted)
              && e.nativeEvent.inputType === "insertText";
            input.value = completeHour ? formatted + ":00" : formatted;
            onChange?.(e);
            if (completeHour) {
              const start = formatted.length + 1;
              requestAnimationFrame(() => input.setSelectionRange(start, start + 2));
            }
          }}
          onBlur={(e) => {
            if (/^(?:[1-9]|0[1-9]|1[0-2])$/.test(e.target.value)) {
              e.target.value += ":00";
              onChange?.(e);
            }
          }}
          required={required}
        />
        <select
          name={name + "Period"}
          aria-label={label + " AM/PM"}
          value={period}
          defaultValue={period === undefined ? initialPeriod : undefined}
          onChange={onPeriodChange}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </div>
  );
}

export function PhoneInput() {
  return (
    <input
      type="tel"
      name="phone"
      inputMode="numeric"
      autoComplete="tel-national"
      maxLength={11}
      pattern="[0-9]{11}"
      title="Enter exactly 11 digits"
      placeholder="03001234567"
      required
    />
  );
}
export const bookingDateLabel = d => DateTime.fromISO(d).setLocale("en-GB").toFormat("dd-LLL-yyyy");
export const fmt = (d) => DateTime.fromISO(d).toFormat("ccc, dd LLL yyyy");
export const amount = (n, c) => c + " " + Number(n).toLocaleString("en-PK");
export function useData(fn, deps, pollInterval) {
  const [data, set] = useState(null),
    [error, err] = useState("");
  useEffect(() => {
    let live = true;
    let pending = false;
    if (!pollInterval) set(null);
    err("");
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const result = await fn();
        if (live) {
          set(result);
          err("");
        }
      } catch (e) {
        if (live) err(e.message);
      } finally {
        pending = false;
      }
    }
    load();
    const refreshVisible = () => { if (!document.hidden) load(); };
    const timer = pollInterval && window.setInterval(refreshVisible, pollInterval);
    if (pollInterval) {
      document.addEventListener("visibilitychange", refreshVisible);
      window.addEventListener("focus", refreshVisible);
    }
    return () => {
      live = false;
      if (pollInterval) {
        window.clearInterval(timer);
        document.removeEventListener("visibilitychange", refreshVisible);
        window.removeEventListener("focus", refreshVisible);
      }
    };
  }, deps);
  return [data, error];
}
export function Modal({ title, close, children, className }) {
  const ref = useRef(null);
  const headingId = useId();
  useEffect(() => {
    const prev = document.activeElement, dlg = ref.current;
    dlg.showModal();
    return () => {
      dlg.close();
      prev?.focus();
    };
  }, []);
  return (
    <dialog className={className} ref={ref} aria-labelledby={headingId} onCancel={e => { e.preventDefault(); close(); }}>
      <div className="modalhead">
        <h2 id={headingId}>{title}</h2>
        <button className="icon" aria-label="Go back" onClick={close}>
          <ArrowLeft />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function receiptURL(booking) {
  return "/api/bookings/" + encodeURIComponent(booking.id) + "/receipt?" +
    new URLSearchParams({ date: booking.date, receipt: booking.receipt });
}
function ReceiptViewer({ booking, close }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let url;
    async function load() {
      const response = await fetch(receiptURL(booking), { signal: controller.signal });
      if (!response.ok) throw Error("Receipt could not be loaded.");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (!["image/jpeg", "image/png", "application/pdf"].includes(blob.type))
        throw Error("Unsupported receipt format.");
      url = URL.createObjectURL(blob);
      setFile({ url, pdf: blob.type === "application/pdf" });
    }
    load().catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [booking.id, booking.date, booking.receipt]);
  return <Modal className="receipt-screen" title="Payment receipt" close={close}>
    {file?.pdf && <a className="receipt-download" href={file.url} download={booking.id + ".pdf"}>Download PDF</a>}
    <div className="receipt-canvas">
      {error ? <p role="alert">{error}</p> : !file ? <p role="status">Loading receipt…</p> :
        file.pdf ? <iframe title="Original payment receipt" src={file.url} /> :
          <img src={file.url} alt="Uploaded payment receipt" onError={() => setError("Receipt image could not be displayed.")} />}
    </div>
  </Modal>;
}
export function ReceiptLink({ booking, children }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="receipt-button" onClick={() => setOpen(true)}>
      <FileText size={16} aria-hidden="true" />{children}
    </button>
    {open && <ReceiptViewer booking={booking} close={() => setOpen(false)} />}
  </>;
}
export function Badge({ v }) {
  return (
    <span className={"badge b-" + v.split(" ")[0].toLowerCase()}>{v}</span>
  );
}
export function Row({ k, children }) {
  return (
    <div className="row">
      <span>{k}</span>
      <b>{children}</b>
    </div>
  );
}
export function Entry({ b, cfg, children }) {
  return (
    <article className="entry">
      <div className="between">
        <strong>{cfg.courts.find((c) => c.id === b.court)?.name}</strong>
        <Badge v={b.status} />
      </div>
      <p>
        {fmt(b.date)} · {time(b.start)} – {time(b.start + b.duration)}
      </p>
      <small>
        {b.vip && "VIP · "}{b.id} · {amount(b.total, cfg.currency)}
      </small>
      {children}
    </article>
  );
}
export function SportIcon({ sport }) {
  return (
    <svg
      className="sporticon"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {sport === "Cricket" ? (
        <>
          <g transform="rotate(40 24 24)">
            <path d="M22 3h4v15l4 5v19h-12V23l4-5z" />
            <path d="M22 7h4m-4 4h4m-4 13v14" />
          </g>
          <circle cx="36" cy="34" r="6" />
          <path d="m32 31 7 6" />
        </>
      ) : (
        <>
          <g transform="rotate(33 24 22)">
            <ellipse cx="23" cy="16" rx="11" ry="14" />
            <path d="m17 29 5 6h2l5-6M21 35h5v9h-5z" />
            {sport === "Tennis" ? (
              <path d="M18 6v18m5-20v24m5-22v18M14 12h18m-19 6h20m-17 6h13" />
            ) : (
              <>
                {[10, 16, 22].map((y) =>
                  [19, 24, 29].map((x) => (
                    <circle
                      key={x + ":" + y}
                      cx={x}
                      cy={y}
                      r="1"
                      fill="currentColor"
                    />
                  )),
                )}
              </>
            )}
          </g>
        </>
      )}
    </svg>
  );
}
