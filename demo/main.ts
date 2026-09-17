import "../src/index";

const status = document.querySelector<HTMLElement>("#status");

if (!status) {
  throw new Error("Demo status element was not found.");
}

status.textContent = "Bootstrap ready — public DiceKit module loaded successfully.";
