const { chromium } = require("playwright");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
const config = require("./config.json");

dayjs.extend(customParseFormat);

const fs = require("fs");

// Helper function to get current date and time
function getCurrentDateTime() {
  const now = new Date();
  return now.toISOString();
}

// Helper function to format the log message
function formatLogMessage(level, message) {
  const timestamp = getCurrentDateTime();
  return `${timestamp} - ${level}: ${message}`;
}

// Log to console and file
function logToFile(message) {
  const logMessage = formatLogMessage("INFO", message);

  // Log to console
  console.log(logMessage);

  // Log to file
  fs.appendFile(logFileName, logMessage, (err) => {
    if (err) {
      console.error("Error writing to file:", err);
    }
  });
}

// Log error to console and file
function logErrorToFile(error) {
  const logMessage = formatLogMessage("ERROR", error);

  // Log to console
  console.error(logMessage);

  // Log to file
  fs.appendFile(logFileName, logMessage, (err) => {
    if (err) {
      console.error("Error writing to file:", err);
    }
  });
}

// Generate the log file name with a timestamp
const timestamp = getCurrentDateTime().replace(/[-:.]/g, "");
// create log directory
if (!fs.existsSync("log")) {
  fs.mkdirSync("log");
}
const logFileName = `log/logfile_${timestamp}.log`;

// Print the log file name
console.log(`Log file: ${logFileName}`);

const bookTennis = async () => {
  logToFile(`${dayjs().format()} - Starting searching tennis`);
  const browser = await chromium.launch({
    headless: true,
    slowMo: 0,
    timeout: 120000,
  });

  logToFile(`${dayjs().format()} - Browser started`);
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.goto(
    "https://tennis.paris.fr/tennis/jsp/site/Portal.jsp?page=tennis&view=start&full=1"
  );

  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.click("#button_suivi_inscription"),
  ]);
  await popup.waitForLoadState();
  await popup.fill("#username-login", config.account.email);
  await popup.fill("#password-login", config.account.password);
  await popup.click("section >> button");

  logToFile(`${dayjs().format()} - User connected`);

  // wait for login redirection before continue
  await page.waitForSelector(".main-informations");

  try {
    for (const location of config.locations) {
      logToFile(`${dayjs().format()} - Search at ${location}`);
      await page.goto(
        "https://tennis.paris.fr/tennis/jsp/site/Portal.jsp?page=recherche&view=recherche_creneau#!"
      );

      // select tennis location
      await page.type(".tokens-input-text", location);
      await page.waitForSelector(
        `.tokens-suggestions-list-element >> text="${location}"`
      );
      await page.click(
        `.tokens-suggestions-list-element >> text="${location}"`
      );

      logToFile("debug 1");

      // select date
      await page.click("#when");
      const date = dayjs(config.date, "D/MM/YYYY");
      await page.waitForSelector(`[dateiso="${date.format("DD/MM/YYYY")}"]`);
      await page.click(`[dateiso="${date.format("DD/MM/YYYY")}"]`);
      await page.waitForSelector(".date-picker", { state: "hidden" });

      await page.click("#rechercher");

      logToFile("debug 2");

      // wait until the results page is fully loaded before continue
      await page.waitForLoadState("domcontentloaded");

      hoursLoop: for (const hour of config.hours) {
        // log the current hour with a prefix debug 3
        logToFile("debug 3 - " + hour);
        const dateDeb = `[datedeb="${date.format(
          "YYYY/MM/DD"
        )} ${hour}:00:00"]`;
        if (await page.$(dateDeb)) {
          if (await page.isHidden(dateDeb)) {
            await page.click(
              `#head${location.replaceAll(" ", "")}${hour}h .panel-title`
            );
          }

          const slots = await page.$$(dateDeb);
          for (const slot of slots) {
            // log the current slot with a prefix debug 4
            logToFile("debug 4 - " + slot);
            const bookSlotButton = `[courtid="${await slot.getAttribute(
              "courtid"
            )}"]${dateDeb}`;
            const [priceType, courtType] = await (
              await (
                await page.$(`.price-description:left-of(${bookSlotButton})`)
              ).innerHTML()
            ).split("<br>");
            if (
              !config.priceType.includes(priceType) ||
              !config.courtType.includes(courtType)
            ) {
              continue;
            }
            await page.click(bookSlotButton);

            break hoursLoop;
          }
        }
      }

      if ((await page.title()) !== "Paris | TENNIS - Reservation") {
        logToFile(
          `${dayjs().format()} - Failed to find reservation for ${location}`
        );
        continue;
      }

      await page.waitForLoadState("domcontentloaded");

      if (await page.$(".captcha")) {
        await page.goto(
          "https://tennis.paris.fr/tennis/jsp/site/Portal.jsp?page=reservation&view=reservation_creneau"
        );
        await page.waitForLoadState("domcontentloaded");
      }

      logToFile(config.players.length);

      for (const [i, player] of config.players.entries()) {
        // log the current player with a prefix debug 5
        logToFile("debug 5 - " + player.firstName + " " + player.lastName);
        logToFile(i + " " + player.firstName + " " + player.lastName);
        if (i > 0 && i < config.players.length) {
          logToFile("debug 5.2");
          await page.click(".addPlayer");
        }
        await page.waitForSelector(`[name="player${i + 1}"]`);
        await page.fill(`[name="player${i + 1}"] >> nth=0`, player.lastName);
        await page.fill(`[name="player${i + 1}"] >> nth=1`, player.firstName);
        logToFile("debug 5.1");
      }

      logToFile("debug 5.5");

      await page.keyboard.press("Enter");

      // log debug 6
      logToFile("debug 6");

      await page.waitForSelector("#order_select_payment_form #paymentMode", {
        state: "attached",
      });
      const paymentMode = await page.$(
        "#order_select_payment_form #paymentMode"
      );
      await paymentMode.evaluate((el) => {
        el.removeAttribute("readonly");
        el.style.display = "block";
      });
      await paymentMode.fill("existingTicket");

      logToFile("debug 7");

      const submit = await page.$("#order_select_payment_form #envoyer");
      submit.evaluate((el) => el.classList.remove("hide"));
      await submit.click();

      logToFile("debug 8");

      await page.waitForSelector(".confirmReservation");

      logToFile(
        `${dayjs().format()} - Réservation faite : ${await (
          await (await page.$(".address")).textContent()
        )
          .trim()
          .replace(/( ){2,}/g, " ")}`
      );
      logToFile(
        `pour le ${await (await (await page.$(".date")).textContent())
          .trim()
          .replace(/( ){2,}/g, " ")}`
      );
      break;
    }
  } catch (e) {
    logToFile(e);
    await page.screenshot({ path: "failure.png" });
  }

  await browser.close();
  return true;
};

// bookTennis()

const bookTennisLoop = async () => {
  const interval = config.interval * 1000;
  const warmUpTime = config.warmUpTime * 1000;
  const stopInterval = config.stopInterval * 1000;
  const intervalVariability = config.intervalVariability * 1000;

  const targetTime = new Date();
  const [targetHour, targetMinute, targetSecond] = config.targetTime
    .split(":")
    .map(Number);
  targetTime.setHours(targetHour, targetMinute, targetSecond, 0);

  const startTime = new Date(targetTime.getTime() - warmUpTime);
  const stopTime = new Date(targetTime.getTime() + stopInterval);

  while (true) {
    // log time day hour minute second
    logToFile(
      dayjs().format() +
        " - " +
        dayjs().format("dddd") +
        " - " +
        dayjs().format("HH:mm:ss")
    );
    const now = new Date();
    if (now >= stopTime) {
      break;
    }

    if (now >= startTime) {
      try {
        const reservation = await bookTennis();
        if (reservation) {
          break;
        }
      } catch (e) {
        logToFile(e);
      }
    }

    await new Promise((resolve) =>
      setTimeout(
        resolve,
        interval +
          Math.floor(Math.random() * 2 * intervalVariability) -
          intervalVariability
      )
    );
  }
};

bookTennisLoop();
