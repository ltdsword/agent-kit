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

export default class RunBoard extends View {
  init(_props, cx) {
    this.data = null;
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
    if (!data) {
      return v_flex().size_full().min_h(0).p(12).bg(t.background).text_color(t.muted)
        .text_size(13).child("Waiting for data");
    }
    const counts = {};
    for (const task of data.tasks ?? []) counts[task.status] = (counts[task.status] ?? 0) + 1;
    const summary = Object.entries(counts).map(([status, count]) => `${status.toLowerCase()} ${count}`).join(" · ")
      || "no tasks";
    const pending = (data.decisions ?? []).filter((decision) => !decision.answer);
    return v_flex().size_full().min_h(0).p(10).gap(8).bg(t.background).text_color(t.foreground).text_size(13)
      .child(v_flex().flex_none().gap(4)
        .child(div().text_size(14).font_semibold().child(data.title || data.run_id || "Run"))
        .child(h_flex().gap(5).text_size(12).text_color(t.muted)
          .child(div().text_color(statusColor(data.status, t)).child(data.status || "Unknown"))
          .child(div().child("·"))
          .child(div().min_w(0).child(summary))))
      .child(v_flex().id("rows").flex_1().min_h(0).overflow_y_scrollbar().gap(10)
        .child(v_flex().gap(5)
          .child(div().text_size(12).font_semibold().text_color(t.muted).child("Tasks"))
          .children((data.tasks ?? []).map((task) => h_flex().min_w(0).gap(7).items_start()
            .child(div().flex_none().text_size(12).text_color(statusColor(task.status, t)).child(task.status || "Unknown"))
            .child(v_flex().min_w(0).gap(2)
              .child(div().text_size(13).child(`${task.id}: ${task.title || "Untitled task"}`))
              .when(Boolean(task.worker || task.verdict), (row) => row.child(div().text_size(12).text_color(t.dim)
                .child([task.worker, task.verdict].filter(Boolean).join(" · ")))))))))
        .when(pending.length > 0, (list) => list.child(v_flex().gap(5)
          .child(div().text_size(12).font_semibold().text_color(t.muted).child("Pending decisions"))
          .children(pending.map((decision) => v_flex().gap(2)
            .child(div().text_size(13).child(`${decision.id}: ${decision.title || "Decision"}`))
            .child(div().text_size(12).text_color(t.dim).child(decision.question || ""))))));
  }
}
