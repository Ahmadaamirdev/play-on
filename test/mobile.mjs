import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { MongoClient } from "mongodb";
import { DateTime } from "luxon";
import { makeApp } from "../server/app.js";
import { readFile } from "node:fs/promises";

const mongo = await MongoMemoryReplSet.create({
  binary: { version: "7.0.24" },
  replSet: { count: 1, args: ["--nounixsocket"] },
});
const client = new MongoClient(mongo.getUri("mobile_test"));
let server, browser;
try {
  await client.connect();
  const app = await makeApp(client.db(), { DEMO_SEED: "true" });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const player = await browser.newPage({
      viewport: { width: 360, height: 740 },
      isMobile: true,
    }),
    adminContext = await browser.newContext({ viewport: { width: 1280, height: 850 } }),
    admin = await adminContext.newPage(),
    observer = await browser.newPage();
  const width = async (page) =>
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "Page overflows the viewport.",
    );
  const errors = [];
  [player, admin, observer].forEach((page) =>
    page.on("pageerror", (e) => errors.push(e.message)),
  );
  async function sign(page, role) {
    await page.goto(url + (role === "admin" ? "/admin" : "/"));
    if (role === "player") {
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    }
    await expect(page.getByText("Explore a demo account")).toHaveCount(0);
    await page.getByLabel("Email").fill(role + "@playon.test");
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("PlayOnDemo2026!");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  }
  let releaseAvailability;
  const delayed = new Promise(resolve => { releaseAvailability = resolve; });
  await observer.route("**/api/availability?**", async route => { await delayed; await route.continue(); });
  await observer.goto(url);
  await expect(observer.getByText("Checking availability…")).toBeVisible();
  releaseAvailability();
  await observer.unrouteAll({behavior:"wait"});
  await sign(player, "player");
  await expect(player.getByRole("button", { name: "Demo Player" })).toBeVisible();
  const date = DateTime.now()
    .setZone("Asia/Karachi")
    .plus({ days: 1 })
    .toISODate();
  await sign(admin, "admin");
  await expect(admin.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
  await expect(admin.locator(".schedule-metrics > div")).toHaveCount(4);
  const records = (await client.db().collection("days").find().toArray()).flatMap(day => day.bookings);
  const counts = admin.locator(".schedule-metrics strong");
  const range = admin.getByRole("group", {name:"Schedule view"});
  const initialDay = await admin.getByLabel("Date", { exact: true }).inputValue();
  for (const [period, prefix] of [["Year", 4], ["Month", 7], ["Day", 10]]) {
    await range.getByRole("button", {name:period, exact:true}).click();
    const subset = records.filter(b => b.date.startsWith(initialDay.slice(0, prefix)));
    const confirmed = subset.filter(b => b.status === "Confirmed" && !b.vip).length;
    const vip = subset.filter(b => b.status === "VIP" || (b.status === "Confirmed" && b.vip)).length;
    const pending = subset.filter(b => b.status === "Pending verification" ||
      (b.status === "Awaiting payment" && (b.expires == null || b.expires > Date.now()))).length;
    await expect(counts).toHaveText([confirmed + vip + pending, confirmed, vip, pending].map(String));
  }
  await admin.getByRole("button", { name: "Next day" }).click();
  await expect(admin.getByLabel("Date", { exact: true })).toHaveValue(date);
  await admin.getByRole("button", { name: "Previous day" }).click();
  await expect(admin.getByLabel("Date", { exact: true })).toHaveValue(initialDay);
  const courtCards = admin.locator(".court-grid .daycourt");
  await expect(courtCards).toHaveCount(6);
  const courtFiles = {
    "cricket-indoor": "Premium Indoor Cricket Training Facility.png",
    "cricket-outdoor": "Sunny Outdoor Cricket Field with Yellow Stumps.png",
    "tennis-indoor": "Modern Indoor Tennis Court.png",
    "tennis-outdoor": "Sunny Green Tennis Court.png",
    "padel-indoor": "Modern Indoor padel Court.png",
    "padel-outdoor": "Sunny Green padel Court .png",
  };
  for (const [courtId, file] of Object.entries(courtFiles)) {
    const image = await admin.locator(`[data-court="${courtId}"] h3`).evaluate(header =>
      getComputedStyle(header).backgroundImage.match(/url\("([^"]+)"\)/)?.[1]);
    assert.ok(image);
    const response = await admin.request.get(image);
    assert.ok(response.ok());
    assert.ok((await response.body()).equals(await readFile(new URL("../src/assets/" + file, import.meta.url))));
  }
  const desktopFirst = await courtCards.first().boundingBox();
  const desktopNext = await courtCards.nth(1).boundingBox();
  assert.equal(desktopFirst.y, desktopNext.y);
  async function checkStickyNavigation(width) {
    await admin.setViewportSize({ width, height: 520 });
    await admin.evaluate(() => window.scrollTo(0, 100));
    const positions = await admin.evaluate(() => ({
      scroll: window.scrollY,
      header: document.querySelector(".ops-header").getBoundingClientRect().toJSON(),
      sidebar: document.querySelector(".ops-sidebar").getBoundingClientRect().toJSON(),
    }));
    assert.ok(positions.scroll > 0);
    assert.equal(positions.header.top, 0);
    assert.equal(positions.sidebar.top, positions.header.bottom);
    await admin.evaluate(() => window.scrollTo(0, 0));
  }
  for (const [w,h] of [[320,568],[375,667],[390,844],[430,932],[600,800],[767,900],[768,1024],[844,390],[1023,768],[1024,768],[1440,900]]) {
    for (const page of [player, admin]) {
      await page.setViewportSize({width:w,height:h});
      await width(page);
    }
  }
  for (const w of [320, 768]) {
    await admin.setViewportSize({width:w,height:820});
    for (const section of ["Payments","Check-in","Finance","Players","Rates","Schedule"]) {
      if (w < 768) await admin.getByRole("button",{name:/^Sections /}).click();
      await admin.getByRole("navigation",{name:"Staff navigation"}).getByRole("button",{name:section,exact:true}).click();
      await width(admin);
    }
  }
  await player.setViewportSize({width:360,height:740});
  await checkStickyNavigation(1280);
  await checkStickyNavigation(360);
  await admin.setViewportSize({ width: 360, height: 740 });
  await width(admin);
  const mobileFirst = await courtCards.first().boundingBox();
  const mobileNext = await courtCards.nth(1).boundingBox();
  assert.ok(mobileNext.y >= mobileFirst.y + mobileFirst.height);
  await admin.setViewportSize({ width: 1280, height: 850 });
  await expect(admin.getByRole("button", { name: "Payments", exact: true })).toBeVisible();
  const staffOnPlayer = await adminContext.newPage();
  await staffOnPlayer.goto(url + "/my-bookings");
  await expect(staffOnPlayer.getByRole("button", { name: "Sign in to view bookings" })).toBeVisible();
  await expect(staffOnPlayer.getByRole("button", { name: "Venue Staff", exact: true })).toHaveCount(0);
  await staffOnPlayer.getByRole("button", { name: "Book a court", exact: true }).click();
  await expect(staffOnPlayer.getByRole("button", { name: "Staff", exact: true })).toHaveCount(0);
  await staffOnPlayer.getByRole("button", { name: "Sign in", exact: true }).click();
  const playerLogin = staffOnPlayer.getByRole("dialog").filter({ hasText: "Player sign in" });
  await playerLogin.getByLabel("Email").fill("admin@playon.test");
  await playerLogin.getByLabel("Password", { exact: true }).fill("PlayOnDemo2026!");
  await playerLogin.getByRole("button", { name: "Sign in" }).click();
  await expect(playerLogin.getByRole("alert")).toHaveText("This account uses Staff sign in.");
  await playerLogin.getByRole("link", { name: "Staff sign in" }).click();
  await expect(staffOnPlayer).toHaveURL(url + "/admin");
  await expect(staffOnPlayer.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
  await admin.reload();
  await expect(admin.getByRole("button", { name: "Venue Staff", exact: true })).toBeVisible();
  await staffOnPlayer.close();
  await observer.goto(url);
  await observer.getByLabel("Booking date").fill(date);
  await expect(observer.getByText("No bookings for this court on this date.")).toBeVisible();
  await player.locator("input[type=date]").fill(date);
  await player.getByLabel("Start time", { exact: true }).fill("6:05");
  await player.getByLabel("End time", { exact: true }).fill("7:35");
  await player.getByRole("combobox", { name: "Start time AM/PM" }).selectOption("PM");
  await player.getByRole("combobox", { name: "End time AM/PM" }).selectOption("PM");
  await expect(player.getByText("6:05 PM – 7:35 PM", { exact: true })).toBeVisible();
  await expect(player.getByText("PKR 3,000", { exact: true })).toBeVisible();
  await width(player);
  await player.getByRole("button", { name: "Continue to payment" }).click();
  await player.getByLabel("Mobile number").fill("0300123456");
  await player.getByRole("button", { name: "Hold court & view payment details" }).click();
  await expect(player.getByRole("heading", { name: "Player details" })).toBeVisible();
  assert.equal(await player.getByLabel("Mobile number").evaluate((input) => input.validity.patternMismatch), true);
  await player.getByLabel("Mobile number").fill("03001234567");
  await player.getByLabel("Mobile number").press("8");
  await expect(player.getByLabel("Mobile number")).toHaveValue("03001234567");
  await player
    .getByRole("button", { name: "Hold court & view payment details" })
    .click();
  await expect(player.getByRole("heading", {name:"Submit payment receipt"})).toBeVisible();
  await width(player);
  await player
    .locator("input[type=file]")
    .setInputFiles({
      name: "demo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKpMAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await player.getByRole("button", { name: "Submit for verification" }).click();
  await expect(
    player.getByText("Pending verification", { exact: true }),
  ).toBeVisible();
  await expect(player).toHaveURL(url + "/my-bookings");
  await player.getByRole("button", {name:"View receipt"}).click();
  const viewer = player.getByRole("dialog", {name:"Payment receipt"});
  await expect(viewer.getByRole("img", {name:"Uploaded payment receipt"})).toBeVisible();
  await viewer.getByRole("button", {name:"Go back"}).click();
  await expect(player.getByRole("heading", {name:"My bookings"})).toBeVisible();
  const pendingTab = admin.getByRole("button", { name: "Payments, 1 awaiting verification" });
  await expect(pendingTab).toContainText("1", { timeout: 8000 });
  const tabBox = await pendingTab.boundingBox();
  const badgeBox = await pendingTab.locator(".payment-count").boundingBox();
  assert.ok(Math.abs(badgeBox.x + badgeBox.width / 2 - (tabBox.x + tabBox.width)) <= 1.5);
  assert.ok(Math.abs(badgeBox.y + badgeBox.height / 2 - tabBox.y) <= 1.5);
  await expect(observer.getByRole("listitem").filter({ hasText: "6:05 PM – 7:35 PM" })).toBeVisible({ timeout: 8000 });
  await player.getByRole("button", { name: "Book a court", exact: true }).click();
  await expect(player.getByLabel("Booking date")).toHaveValue(date);
  await expect(player.getByRole("listitem").filter({ hasText: "6:05 PM – 7:35 PM" })).toBeVisible();
  await player.getByLabel("Start time", { exact: true }).fill("7:34");
  await player.getByLabel("End time", { exact: true }).fill("8:35");
  await player.getByRole("combobox", { name: "Start time AM/PM" }).selectOption("PM");
  await player.getByRole("combobox", { name: "End time AM/PM" }).selectOption("PM");
  await expect(player.getByRole("alert")).toHaveText(/overlaps an existing booking/);
  await player.getByLabel("Start time", { exact: true }).fill("7:35");
  await expect(player.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
  await player.getByLabel("Start time", { exact: true }).fill("11:00");
  await player.getByLabel("End time", { exact: true }).fill("12:00");
  await player.getByRole("combobox", { name: "End time AM/PM" }).selectOption("AM");
  await expect(player.getByText("11:00 PM – 12:00 AM", { exact: true })).toBeVisible();
  await expect(player.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
  await player.goto(url + "/my-bookings");
  await admin.reload();
  await expect(admin.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
  await admin.setViewportSize({width:375,height:740});
  async function staffSection(name) {
    await admin.getByRole("button",{name:/^Sections /}).click();
    await admin.getByRole("navigation",{name:"Staff navigation"}).getByRole("button",{name,exact:true}).click();
    await width(admin);
  }
  await staffSection("Payments, 1 awaiting verification");
  await admin
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(
    admin.getByText("Expected amount", { exact: true }),
  ).toBeVisible();
  await admin.getByLabel("Reason for rejection").fill("Receipt amount is unreadable");
  await admin.getByRole("button",{name:"Reject",exact:true}).click();
  await expect(admin.getByRole("button",{name:"Confirm rejection"})).toBeVisible();
  await admin.getByRole("group",{name:"Confirm payment decision"}).getByRole("button",{name:"Go back"}).click();
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await admin.getByRole("button", {name:"Confirm approval"}).click();
  await expect(admin.getByText("0 awaiting verification")).toBeVisible();
  await player.getByRole("button", { name: "Refresh bookings" }).click();
  const invoice = player.locator(".entry").filter({ hasText: "6:05 PM – 7:35 PM" }).getByRole("link", { name: "Download payment slip" });
  await expect(invoice).toBeVisible();
  const download = player.waitForEvent("download");
  await invoice.click();
  const file = await download,
    id = file.suggestedFilename().replace(".pdf", "");
  assert.match(id, /^PO-[0-9]{6}$/);
  assert.equal(
    (await readFile(await file.path())).subarray(0, 5).toString(),
    "%PDF-",
  );
  await width(player);
  await staffSection("Check-in");
  await admin.getByLabel("Booking ID").fill(id.slice(3));
  await admin.getByRole("button", { name: "Find booking" }).click();
  await expect(
    admin.getByText(/Confirm registered mobile · 03001234567/),
  ).toBeVisible();
  await admin.getByRole("button", { name: "Mark checked in" }).click();
  await expect(admin.getByText(/Already checked in/)).toBeVisible();
  await staffSection("Finance");
  await expect(admin.getByLabel("Report by")).toHaveCount(0);
  await admin.getByText(/^Date and time options/).click();
  await admin.getByLabel("Date range",{exact:true}).selectOption("Daily");
  await admin.getByLabel("Reference date").fill(date);
  await expect(admin.locator(".finance-kpis strong").first()).toHaveText("PKR 3,000");
  await expect(admin.getByText(new RegExp(id))).toBeVisible();
  await admin.getByLabel("Court setting").selectOption("Indoor");
  await admin.getByLabel("Slot start time").fill("19:00");
  await admin.getByLabel("Slot end time").fill("20:00");
  await admin.getByLabel("Sport",{exact:true}).selectOption("Cricket");
  await admin.getByLabel("Search finance records").fill("missing-payment");
  await expect(admin.getByText("No records match your search.")).toBeVisible();
  await admin.getByLabel("Search finance records").fill(id);
  await expect(admin.getByRole("region", { name: "Payments" }).getByText(id, { exact: true })).toBeVisible();
  const csvDownload = admin.waitForEvent("download");
  await admin.getByRole("button",{name:"Export",exact:true}).click();
  const csv = await csvDownload;
  assert.ok((await readFile(await csv.path(),"utf8")).includes(id));
  await admin.getByRole("button",{name:"Booking details for " + id}).click();
  await expect(admin.getByRole("dialog")).toContainText("Verified");
  await admin.getByRole("dialog").getByRole("button",{name:"Go back",exact:true}).click();
  await admin.getByRole("button", { name: "Bookings revenue", exact: true }).click();
  const bookedSlots = admin.getByRole("region", { name: "Booked slots" });
  await expect(bookedSlots.getByText(new RegExp(id))).toBeVisible();
  await admin.getByLabel("Court setting").selectOption("Outdoor");
  await expect(bookedSlots.getByText("No matching booked slots.")).toBeVisible();
  await staffSection("Players");
  await admin.getByLabel("Search by name or email").fill("player@playon.test");
  await admin.getByRole("button", { name: /Demo Player.*player@playon.test/ }).click();
  const profile = admin.getByRole("dialog");
  await expect(profile.getByRole("heading", { name: "Booking history" })).toBeVisible();
  await expect(profile.getByText(new RegExp(id))).toBeVisible();
  await profile.getByRole("button", { name: "Go back" }).click();

  await staffSection("Schedule");
  await admin.getByLabel("Date", { exact: true }).fill(date);
  await admin.getByText("Filters & court actions", { exact: true }).click();
  await admin.getByRole("button", { name: "Reserve for VIP" }).click();
  await admin.getByLabel("Start time", { exact: true }).fill("8:10");
  await admin.getByLabel("End time", { exact: true }).fill("9:10");
  await admin.getByRole("combobox", { name: "Start time AM/PM" }).selectOption("PM");
  await admin.getByRole("combobox", { name: "End time AM/PM" }).selectOption("PM");
  await admin.getByLabel("Guest full name").fill("VIP Guest");
  await admin.getByLabel("Guest mobile").fill("03001234567");
  await admin.locator('select[name="paymentType"]').selectOption("Complimentary");
  await admin.getByRole("button", { name: "Reserve court" }).click();
  await expect(admin.getByText("8:10 PM – 9:10 PM", { exact: true })).toBeVisible();
  await admin.getByRole("button",{name:"Close courts"}).click();
  await admin.getByLabel("Closure applies to").selectOption("tennis-outdoor");
  await admin.getByRole("button",{name:"Apply day closure"}).click();
  await expect(admin.locator('[data-court="tennis-outdoor"]').getByText("Closed")).toBeVisible();
  await staffSection("Rates");
  const rates = admin.locator(".rateform").first();
  await rates.locator("input").fill("2400");
  await rates.getByRole("button",{name:"Save"}).click();
  await expect(admin.getByRole("status")).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 360px player booking and VIP reservation with AM/PM controls, receipt upload, approval, invoice, check-in and finance.",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  await client.close();
  await mongo.stop();
}
