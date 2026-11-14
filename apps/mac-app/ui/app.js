/* global document, window, confirm, queueMicrotask */
// Draws whatever state the app sends. No decisions are made here.
const $ = (id) => document.getElementById(id);
const ORDER = ["pair", "access", "ready"];

// The thread being given a name, kept here so a redraw does not lose typing.
let adding = null; // { handle, name, history }
const HISTORY_CHOICES = [
  ["new", "New messages only"],
  ["30days", "Last 30 days"],
  ["all", "Everything"],
];

function threadRow(thread) {
  const li = document.createElement("li");
  if (adding && adding.handle === thread.handle) {
    const form = document.createElement("form");
    form.className = "add-form";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Their name";
    input.value = adding.name;
    input.setAttribute("aria-label", `Name for ${thread.name ?? thread.handle}`);
    input.addEventListener("input", () => (adding.name = input.value));
    const save = document.createElement("button");
    save.className = "small-button primary";
    save.textContent = "Add";
    const history = document.createElement("select");
    history.setAttribute("aria-label", "How far back to read");
    for (const [value, label] of HISTORY_CHOICES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      history.append(option);
    }
    history.value = adding.history;
    history.addEventListener("change", () => (adding.history = history.value));
    form.append(input, save, history);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      const choice = adding.history;
      adding = null;
      window.helper.addPerson(thread.handle, name, choice);
    });
    li.append(form);
    // Keep the cursor in the box across redraws.
    queueMicrotask(() => input.focus());
    return li;
  }
  const text = document.createElement("span");
  text.className = "name thread-text";
  // The name from Contacts when there is one; the number stays a hover away.
  text.textContent = thread.name ?? thread.handle;
  if (thread.name) text.title = thread.handle;
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = thread.preview;
  text.append(hint);
  const add = document.createElement("button");
  add.className = "small-button";
  add.textContent = "Add";
  add.setAttribute("aria-label", `Add ${thread.name ?? thread.handle}`);
  add.addEventListener("click", () => {
    adding = { handle: thread.handle, name: thread.name ?? "", history: "new" };
    draw(last);
  });
  li.append(text, add);
  return li;
}

let last = null;

function draw(state) {
  last = state;
  const status = $("status");
  status.textContent = state.status;
  status.className =
    "muted " + (state.step === "ready" && !state.error && !state.offline ? "ok" : "due");

  for (const li of document.querySelectorAll("#steps li")) {
    const at = ORDER.indexOf(li.dataset.step);
    const now = ORDER.indexOf(state.step);
    li.className = at < now ? "done" : at === now ? "now" : "";
  }
  for (const step of ORDER) $(step).hidden = step !== state.step;

  const code = $("code");
  code.textContent = state.code ?? "Getting a code…";
  code.classList.toggle("waiting", !state.code);
  $("pair-note").textContent = state.step === "pair" && state.error ? state.error : "";

  const list = $("people");
  list.replaceChildren(
    ...state.people.map((person) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = person.name;
      if (!person.hasHandle) {
        const hint = document.createElement("span");
        hint.className = "hint";
        hint.textContent = "Add their number on your phone first";
        name.append(hint);
      }
      const toggle = document.createElement("button");
      toggle.className = "switch";
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-checked", String(person.capture));
      toggle.setAttribute("aria-label", `Capture ${person.name}`);
      toggle.disabled = !person.hasHandle;
      toggle.addEventListener("click", () => window.helper.setCapture(person.id, !person.capture));
      li.append(name, toggle);
      return li;
    }),
  );
  $("no-people").hidden = state.people.length > 0 || state.offline;
  if (adding && !state.threads.some((t) => t.handle === adding.handle)) adding = null;
  $("threads").replaceChildren(...state.threads.map(threadRow));
  $("from-messages").hidden = state.threads.length === 0;

  $("account").textContent = state.account ?? "";
  $("disconnect").hidden = state.step === "pair";
}

$("open-settings").addEventListener("click", () => window.helper.openSettings());
$("show-app").addEventListener("click", () => window.helper.showApp());
$("relaunch").addEventListener("click", () => window.helper.relaunch());
$("disconnect").addEventListener("click", () => {
  if (confirm("Disconnect this Mac? Messages stop being passed to Cliphy.")) {
    window.helper.disconnect();
  }
});

window.helper.onState(draw);
window.helper.getState().then(draw);
