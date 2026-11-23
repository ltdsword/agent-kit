import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, closeOverlay, exec, home, pickFolder, props, readTextFile, theme, writeTextFile } from "herdr";

// Herdr mods have no Node "path" module: join and normalize POSIX paths by hand.
function resolve(...parts) {
  let path = "";
  for (const part of parts) {
    if (!part) continue;
    path = part.startsWith("/") ? part : `${path}/${part}`;
  }
  const out = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return `/${out.join("/")}`;
}

const RESPONSE_PATH = "data/agent-kit-create/response.json";
const REQUEST_PATH = "data/agent-kit-create/request.json";

function resolvePath(value, cwd) {
  const path = value.trim();
  if (path === "~") return resolve(home());
  if (path.startsWith("~/")) return resolve(home(), path.slice(2));
  return resolve(cwd, path);
}

function repoErrorText(error) {
  const text = String(error?.stderr ?? error?.message ?? "").toLowerCase();
  return text.includes("no such file") || text.includes("not a directory")
    ? "folder not found"
    : "not a git repo";
}

export default class AgentKitCreate extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.ready = false;
    this.done = false;
    this.cancelPending = false;
    this.error = "";
    this.nextRowId = 1;
    this.nameInput = InputState.new({ value: "" });
    this.locationInput = InputState.new({ value: "" });
    this.rows = [this.makeRepoRow("")];
    this.nameInput.on("change", (_e, cx) => cx.notify());
    this.locationInput.on("change", (_e, cx) => cx.notify());
    this.nameInput.on("submit", (_e, cx) => this.submit(cx));
    this.locationInput.on("submit", (_e, cx) => this.submit(cx));
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${appHome()}/${REQUEST_PATH}`);
        if (!text) throw new Error("Workspace request is missing.");
        const request = JSON.parse(text);
        this.request = request;
        this.nameInput.set_value(request.name ?? "");
        this.locationInput.set_value(request.location ?? request.cwd ?? "");
        const requestedRepos = Array.isArray(request.repos) ? request.repos : [];
        this.rows[0].input.set_value(requestedRepos[0] ?? "");
        for (const repo of requestedRepos.slice(1)) this.rows.push(this.makeRepoRow(repo));
        this.ready = true;
        this.nameInput.focus();
        for (const row of this.rows) this.scheduleRepoCheck(row, cx);
        if (this.cancelPending) await this.cancel(cx);
      } catch (_error) {
        this.error = "Could not read the workspace request.";
      }
      cx.notify();
    });
  }

  makeRepoRow(value) {
    const row = { id: this.nextRowId++, status: "checking", input: null, generation: 0, timer: null };
    row.input = InputState.new({ value });
    row.input.on("change", (_e, cx) => {
      this.scheduleRepoCheck(row, cx);
      cx.notify();
    });
    row.input.on("submit", (_e, cx) => this.submit(cx));
    return row;
  }

  canSubmit() {
    return this.ready && !this.done && Boolean(this.nameInput.value().trim()) && this.rows.length > 0 &&
      this.rows.every((row) => row.status === "git repo");
  }

  scheduleRepoCheck(row, cx) {
    row.generation += 1;
    const generation = row.generation;
    row.timer?.cancel();
    const value = row.input.value().trim();
    row.status = value ? "checking" : "folder not found";
    row.detail = value ? "Checking…" : "folder not found";
    if (!value) return;
    row.timer = cx.timer.after(300, (timerCx) => {
      timerCx.spawn(async (checkCx) => {
        const path = resolvePath(value, this.request.cwd);
        try {
          const result = await exec("git", ["-C", path, "rev-parse", "--show-toplevel"]);
          if (row.generation !== generation || !this.rows.includes(row)) return;
          if (result.code !== 0) {
            row.status = repoErrorText(result);
            row.detail = row.status;
          } else {
            const top = resolve(result.stdout.trim());
            // git prints the real path; compare with the folder's real path (symlinked repos).
            const real = await exec("realpath", ["--", path]);
            if (row.generation !== generation || !this.rows.includes(row)) return;
            const here = real.code === 0 ? real.stdout.trim() : path;
            row.status = top === here ? "git repo" : `inside ${top}: pick its top folder`;
            row.detail = row.status;
          }
        } catch (error) {
          if (row.generation !== generation || !this.rows.includes(row)) return;
          row.status = repoErrorText(error);
          row.detail = row.status;
        }
        checkCx.notify();
      });
    });
  }

  browseLocation(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Choose workspace location" });
      if (!folder) return;
      this.locationInput.set_value(folder);
      cx.notify();
    });
  }

  browseRepo(row, cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Choose a repository" });
      if (!folder) return;
      row.input.set_value(folder);
      this.scheduleRepoCheck(row, cx);
      cx.notify();
    });
  }

  addRepo(cx) {
    const row = this.makeRepoRow("");
    this.rows.push(row);
    cx.notify();
  }

  removeRepo(row, cx) {
    if (this.rows.length <= 1) return;
    row.timer?.cancel();
    row.generation += 1;
    this.rows = this.rows.filter((item) => item !== row);
    cx.notify();
  }

  cancel(cx) {
    if (this.done) return;
    if (!this.request) {
      this.cancelPending = true;
      return;
    }
    this.done = true;
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(`${appHome()}/${RESPONSE_PATH}`, JSON.stringify({ id: this.request.id, ok: false }), null);
        closeOverlay(props().overlay);
      } catch (_error) {
        this.done = false;
        this.error = "Could not send the cancellation to the shell.";
        cx.notify();
      }
    });
  }

  submit(cx) {
    if (!this.canSubmit()) return;
    this.done = true;
    const name = this.nameInput.value().trim();
    const location = resolvePath(this.locationInput.value() || this.request.cwd, this.request.cwd);
    const repos = this.rows.map((row) => resolvePath(row.input.value(), this.request.cwd));
    const response = { id: this.request.id, ok: true, name, location, repos };
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(`${appHome()}/${RESPONSE_PATH}`, JSON.stringify(response), null);
        closeOverlay(props().overlay);
      } catch (_error) {
        this.done = false;
        this.error = "Could not send the workspace details to the shell.";
        cx.notify();
      }
    });
  }

  key(event, cx) {
    if (event.key === "escape") {
      this.cancel(cx);
      cx.stop_propagation();
    } else if (event.key === "enter" && this.canSubmit()) {
      this.submit(cx);
      cx.stop_propagation();
    }
  }

  render() {
    const t = theme();
    const button = (id, text, primary, action, disabled = false) =>
      h_flex().id(id).h(32).px(12).items_center().justify_center().rounded(8).border_1()
        .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
        .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
        .when(!disabled, (el) => el.cursor_pointer().hover((style) => style.opacity(0.88)).on_click(action))
        .when(disabled, (el) => el.opacity(0.45)).child(text);
    const label = (text) => div().pt(12).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const field = (input) => Input.new(input).flex_1().h(34).px(10).rounded(8).border_1()
      .border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
    const p = props() ?? {};
    const previewName = this.nameInput.value().trim();
    const workspaceName = previewName && previewName.endsWith(".workspace") ? previewName : `${previewName}.workspace`;
    const workspacePath = this.request && this.locationInput.value().trim()
      ? `${resolvePath(this.locationInput.value(), this.request.cwd)}/${workspaceName}`
      : "";
    const canSubmit = this.canSubmit();

    return v_flex().id("agent-kit-create").track_focus(this.handle).on_key_down((event, cx) => this.key(event, cx))
      .size_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().justify_between().flex_none()
        .child(div().text_size(15).font_semibold().child("New agent-kit workspace"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(!this.ready, (el) => el.child(div().pt(28).text_size(12).text_color(t.dim)
        .child(this.error || "Loading workspace details…")))
      .when(this.ready, (el) => el
        .child(label("Name"))
        .child(field(this.nameInput))
        .child(label("Location"))
        .child(h_flex().gap(8).items_center().flex_none()
          .child(field(this.locationInput))
          .child(button("browse-location", "Browse", false, (_e, cx) => this.browseLocation(cx))))
        .child(div().pt(5).text_size(11).text_color(t.dim).truncate().child(workspacePath))
        .child(label("Repos"))
        .child(v_flex().id("repo-list").flex_1().min_h(0).gap(7).overflow_y_scrollbar().children(
          this.rows.map((row) => v_flex().id(`repo-${row.id}`).gap(3).flex_none()
            .child(h_flex().gap(6).items_center().flex_none()
              .child(field(row.input))
              .child(button(`browse-repo-${row.id}`, "Browse", false, (_e, cx) => this.browseRepo(row, cx)))
              .child(button(`remove-repo-${row.id}`, "Remove", false, (_e, cx) => this.removeRepo(row, cx), this.rows.length <= 1)))
            .child(div().text_size(10.5).text_color(row.status === "git repo" ? t.accent : t.dim)
              .truncate().child(row.detail ?? row.status)))
        ))
        .child(h_flex().pt(7).flex_none()
          .child(button("add-repo", "+ Add repo", false, (_e, cx) => this.addRepo(cx))))
        .when(Boolean(this.error), (inner) => inner.child(div().pt(6).text_size(11).text_color(t.blocked).child(this.error)))
        .child(h_flex().pt(14).gap(8).justify_end().flex_none()
          .child(button("cancel", "Cancel", false, (_e, cx) => this.cancel(cx)))
          .child(button("create", "Create", true, (_e, cx) => this.submit(cx), !canSubmit)))));
  }
}
