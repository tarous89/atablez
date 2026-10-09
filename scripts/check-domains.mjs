import { chromium } from "playwright";
process.env.TEST_MODE = "1";
process.env.TEST_DB = "memory";
const { createApp } = await import("../server/index.ts");
const instance = await createApp();
const http = instance.app.listen(3000, "0.0.0.0");
await new Promise((r) => http.once("listening", r));
let browser;
try {
  for (const [host, landing] of [
    ["atablez.com", true],
    ["app.atablez.com", false],
    ["atablez.onrender.com", false],
  ]) {
    const response = await fetch("http://localhost:3000/", {
      headers: { "X-Forwarded-Host": host },
    });
    const html = await response.text();
    if (
      response.status !== 200 ||
      html.includes("Keep the useful part of the conversation.") !== landing
    )
      throw Error("Wrong hostname route " + host);
  }
  const redirect = await fetch("http://localhost:3000/?invite=example", {
    headers: { "X-Forwarded-Host": "atablez.com" },
    redirect: "manual",
  });
  if (
    redirect.headers.get("location") !==
    "https://app.atablez.com/?invite=example"
  )
    throw Error("Invitation handoff failed");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--single-process",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3000/welcome");
  await page.screenshot({
    path: "/tmp/atablez-landing-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/atablez-landing-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )
  )
    throw Error("Mobile overflow");
  if (errors.length) throw Error(errors.join(";"));
  console.log(
    "Hostname routes, invitation handoff, desktop/mobile landing and browser errors passed",
  );
} finally {
  await browser?.close();
  await new Promise((r) => http.close(r));
  await instance.close();
}
