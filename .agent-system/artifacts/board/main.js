import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { readTextFile, theme } from "herdr";
import { DATA } from "./data.js";
import "./artifact.js";

const statusColor = (status, t) => {
  if (["RUNNING", "REVIEW"].includes(status)) return t.working;
  if (["BLOCKED", "FIX_REQUIRED", "FAILED"].includes(status)) return t.blocked;
  if (["PASSED", "MERGED", "DONE"].includes(status)) return t.done;
  return t.muted;
};

function statusLabel(status, t) {
  return div().flex_none().px(6).py(2).rounded(4).text_size(12)
    .text_color(statusColor(status, t)).child(status || "Unknown");
}

function taskNode(task, t) {
  const dependencies = task.depends_on ?? [];
  return v_flex().min_w(0).gap(4).p(8).rounded(6).border_1()
    .border_color(statusColor(task.status, t)).bg(t.surface)
    .child(h_flex().min_w(0).gap(5).items_center()
      .child(div().flex_none().text_size(12).font_family("monospace").text_color(t.dim)
        .child(task.id || ""))
      .child(div().flex_1().min_w(0).text_size(13).truncate()
        .child(task.title || "Untitled task"))
      .when(Boolean(task.worker && task.status !== "MERGED"), (row) => row.child(
        div().flex_none().max_w(76).text_size(12).truncate().text_color(t.muted).child(task.worker))))
    .when(Boolean(task.summary), (card) => card.child(
      div().min_w(0).text_size(12).text_color(t.muted).child(task.summary)))
    .child(h_flex().min_w(0).flex_wrap().items_center().gap(5)
      .child(statusLabel(task.status, t))
      .when(task.fix_rounds > 0 && task.status !== "MERGED", (row) => row.child(
        div().flex_none().text_size(12).text_color(t.muted).child(`fix ${task.fix_rounds}`)))
      .when(task.status === "PENDING" && dependencies.length > 0, (row) => row.child(
        div().min_w(0).text_size(12).text_color(t.muted).child(`needs ${dependencies.join(", ")}`))));
}

export default class RunBoard extends View {
  init(_props, cx) {
    this.data = null;
    this.wide = false;
    cx.spawn(async (cx) => this.refresh(cx));
    cx.timer.every(5000, (cx) => cx.spawn(async (cx) => this.refresh(cx)));
  }

  async refresh(cx) {
    try {
      const text = await readTextFile(DATA);
      this.data = text ? JSON.parse(text) : null;
    } catch {
      this.data = null;
    }
    cx.notify();
  }

  render() {
    const t = theme();
    const data = this.data;
    const frame = v_flex().id("run-board").size_full().min_w(0).min_h(0)
      .on_size_change((size, cx) => {
        const wide = size.width >= 520;
        if (this.wide !== wide) {
          this.wide = wide;
          cx.notify();
        }
      });
    if (!data) {
      return frame.p(12).bg(t.background).text_color(t.muted).text_size(13)
        .child("Waiting for data");
    }

    const tasks = data.tasks ?? [];
    const roots = tasks.filter((task) => (task.depends_on ?? []).length === 0);
    const dependents = tasks.filter((task) => (task.depends_on ?? []).length > 0);
    const pending = (data.decisions ?? []).filter((decision) => !decision.answer);
    const problems = data.problems ?? [];
    const branchRow = (label, value) => h_flex().min_w(0).gap(8)
      .child(div().flex_none().w(48).text_size(12).text_color(t.muted).child(label))
      .child(div().min_w(0).text_size(12).truncate().child(value));
    const taskGraph = this.wide && dependents.length > 0
      ? h_flex().min_w(0).gap(5)
        .child(v_flex().flex_1().min_w(0).gap(6).children(roots.map((task) => taskNode(task, t))))
        .child(v_flex().flex_none().w(18).items_center().justify_center().text_size(15)
          .text_color(t.dim).child("›"))
        .child(v_flex().flex_1().min_w(0).gap(6).children(dependents.map((task) => taskNode(task, t))))
      : v_flex().min_w(0).gap(6).children([...roots, ...dependents].map((task) => taskNode(task, t)));

    return frame.p(10).gap(8).bg(t.background).text_color(t.foreground).text_size(13)
      .child(v_flex().flex_none().min_w(0).gap(5)
        .child(h_flex().min_w(0).items_start().gap(8)
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().min_w(0).text_size(14).font_semibold().truncate()
              .child(data.title || data.run_id || "Run"))
            .child(div().text_size(12).font_family("monospace").text_color(t.dim)
              .child(`Run ${data.run_id || ""}`)))
          .child(statusLabel(data.status, t)))
        .when(Boolean(data.goal), (header) => header.child(
          div().min_w(0).text_size(13).text_color(t.muted).child(data.goal)))
        .child(v_flex().gap(3)
          .child(branchRow("Branch", data.integration_branch || ""))
          .child(branchRow("Gate", data.gate || "not run"))))
      .child(v_flex().id("rows").flex_1().min_h(0).min_w(0).overflow_y_scrollbar().gap(10)
        .child(v_flex().min_w(0).gap(6)
          .child(div().text_size(12).font_semibold().text_color(t.muted).child("Tasks"))
          .when(tasks.length > 0, (section) => section.child(taskGraph))
          .when(tasks.length === 0, (section) => section.child(
            div().text_size(12).text_color(t.muted).child("No tasks"))))
        .when(problems.length > 0, (list) => list.child(v_flex().min_w(0).gap(5)
          .child(div().text_size(12).font_semibold().text_color(t.muted).child("Problems"))
          .children(problems.map((problem) => v_flex().min_w(0).gap(3).p(8).rounded(6).border_1()
            .border_color(t.blocked).bg(t.surface)
            .child(div().text_size(12).font_semibold().text_color(t.blocked)
              .child(`${problem.task_id || "Run"}: ${problem.type || "Unknown"}`))
            .when(Boolean(problem.note), (item) => item.child(
              div().min_w(0).text_size(12).text_color(t.muted).child(problem.note)))
            .when(Boolean(problem.decision_id), (item) => item.child(
              div().text_size(12).text_color(t.accent).child(`${problem.decision_id} open`)))))))
        .when(pending.length > 0, (list) => list.child(v_flex().min_w(0).gap(5)
          .child(div().text_size(12).font_semibold().text_color(t.muted).child("Pending decisions"))
          .children(pending.map((decision) => v_flex().min_w(0).gap(2)
            .child(div().min_w(0).text_size(13).child(`${decision.id}: ${decision.title || "Decision"}`))
            .child(div().min_w(0).text_size(12).text_color(t.dim).child(decision.question || "")))))));
  }
}
