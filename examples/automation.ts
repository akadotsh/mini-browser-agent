import { BrowserSession } from "../src/browser-session";

const browser = new BrowserSession();

try {
  const navigation = await browser.navigate("https://example.com");
  console.log(navigation.message);

  const snapshot = await browser.snapshot();
  console.log(`Title: ${snapshot.title}`);
  console.log(`URL: ${snapshot.url}`);
  console.log(`Interactive elements: ${snapshot.elements.length}`);

  const heading = await browser.extractText("css:h1");
  const links = await browser.extractLinks();
  console.log(`Heading: ${heading}`);
  console.table(links);

  await browser.scroll(400);

  for (const filename of ["example-home.png", "example-home.jpg", "example-home.webp"]) {
    const screenshot = await browser.screenshot(filename);
    console.log(screenshot.message);
  }
} finally {
  browser.close();
}
