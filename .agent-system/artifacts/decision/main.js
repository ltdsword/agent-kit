import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { readTextFile, theme } from "herdr";
import { DATA, DECISION, RUN } from "./data.js";
import { reply } from "./artifact.js";

export default class DecisionCard extends View {
  init(_props, cx) {
    this.data = null;
    this.choice = null;
    this.sent = false;
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

  send(decision, choice, followup, cx) {
    if (this.sent) return;  // one answer per card
    const suffix = followup ? `, followup ${followup.key}=${followup.value}` : "";
    reply(`decision ${decision.id} (run ${RUN}): ${choice}${suffix}`);
    this.sent = true;
    cx.notify();
  }

  optionButton(id, label, t, onClick, recommended = false) {
    // Clickable elements need a unique id (AGENTS.md: `.id("unique")` then `.on_click`).
    return h_flex().id(id).w_full().min_w(0).px(10).py(7).gap(6).items_center().rounded(6).border(1)
      .border_color(recommended ? t.accent : t.border).bg(t.surface).text_size(13).text_color(t.foreground)
      .on_click((_event, cx) => onClick(cx))
      .child(div().min_w(0).child(label))
      .when(recommended, (button) => button.child(div().flex_none().text_size(12).text_color(t.accent).child("Recommended")));
  }

  render() {
    const t = theme();
    const decision = this.data?.decisions?.find((item) => item.id === DECISION);
    if (!decision) {
      return v_flex().size_full().min_h(0).p(12).bg(t.background).text_color(t.muted)
        .text_size(13).child("Waiting for data");
    }
    if (decision.answer) {
      const chosen = decision.options?.find((option) => option.key === decision.answer.choice);
      const answer = `${chosen?.label || decision.answer.choice || "Answered"}`
        + (decision.answer.followup ? ` · ${decision.answer.followup}` : "");
      return v_flex().size_full().min_h(0).p(12).gap(7).bg(t.background).text_color(t.foreground).text_size(13)
        .child(div().child(`Answered: ${answer}`));
    }
    const followup = decision.followup;
    const showFollowup = this.choice && followup?.when?.includes(this.choice);
    const buttons = showFollowup
      ? (followup.options ?? []).map((option) => this.optionButton(`f-${option.key}`,
          option.input ? `${option.label} · type it in chat` : option.label, t,
          (cx) => this.send(decision, this.choice, option.input ? null : option, cx)))
      : (decision.options ?? []).map((option) => this.optionButton(`o-${option.key}`, option.label, t, (cx) => {
          if (followup?.when?.includes(option.key)) {
            this.choice = option.key;
            cx.notify();
          } else {
            this.send(decision, option.key, null, cx);
          }
        }, option.key === decision.recommend));
    if (showFollowup) {
      buttons.push(this.optionButton("back", "Back to choices", t, (cx) => { this.choice = null; cx.notify(); }));
    }
    const card = v_flex().size_full().min_h(0).p(12).gap(9).bg(t.background)
      .text_color(t.foreground).text_size(13)
      .child(v_flex().flex_none().gap(5)
        .child(div().text_size(14).font_semibold().child(decision.question || "Decision"))
        .child(div().text_size(12).text_color(t.muted)
          .child(showFollowup ? followup.question || "Choose a followup" : "Choose an option")))
      .child(v_flex().id("options").flex_1().min_h(0).overflow_y_scrollbar().gap(6).children(buttons));
    if (this.sent) card.child(div().text_size(12).text_color(t.muted).child("Reply sent"));
    return card;
  }
}
