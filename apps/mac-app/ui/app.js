/* global document, window, confirm */
// Draws whatever state the app sends. No decisions are made here.
const $ = (id) => document.getElementById(id);
const ORDER = ["pair", "access", "ready"];

function draw(state) {
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
