(function (global) {
  "use strict";
  const H = global.HighlightNotes ||= {};
  const strings = {
    en: {
      heading: "Open linked notes",
      positionHeading: "Reading position when opening a note",
      reference: "Go to the highlight reference",
      start: "Read from the beginning",
      positionDescription: "Applies the next time you open a linked note. Reading from the beginning returns to the top every time, including when the same note is already open.",
      click: "Click a highlight",
      modifierMac: "Command + click a highlight",
      modifierOther: "Ctrl + click a highlight",
      description: "With the modifier option, an ordinary click shows the annotation comment without opening a linked note. Changes take effect immediately.",
      conflict: "The modifier shortcut replaces annotation multi-selection on PDF highlights. Multi-selection in the annotation sidebar is unchanged.",
    },
    zh: {
      heading: "打开关联笔记的方式",
      positionHeading: "打开笔记后的阅读位置",
      reference: "定位到高亮引用",
      start: "从笔记开头阅读",
      positionDescription: "下次打开关联笔记时生效。选择从开头阅读后，每次触发均回到顶部，包括已打开的同一篇笔记。",
      click: "直接点击高亮",
      modifierMac: "Command＋点击高亮",
      modifierOther: "Ctrl＋点击高亮",
      description: "选择组合键模式后，普通点击可查看和编辑批注评论，不会打开关联笔记。设置立即生效。",
      conflict: "组合键模式会替代 PDF 正文高亮上的同键多选手势。左侧批注列表仍保留原有的多选行为。",
    },
  };
  H.Settings = {
    key: "extensions.pdf2notelink.triggerMode",
    positionKey: "extensions.pdf2notelink.readingPosition",
    position(Z) { return Z.Prefs.get(this.positionKey, true) === "start" ? "start" : "reference"; },
    mode(Z) { return Z.Prefs.get(this.key, true) === "modifier" ? "modifier" : "click"; },
    strings(Z) { return strings[/^zh(?:[-_]|$)/i.test(Z.locale || "") ? "zh" : "en"]; },
  };
})(typeof module !== "undefined" ? globalThis : this);
