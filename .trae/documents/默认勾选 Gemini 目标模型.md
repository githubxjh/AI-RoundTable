## 现状定位
- 顶部“Global Command”的目标模型默认勾选状态是写死在 HTML 里：ChatGPT/Claude/Grok 有 `checked`，Gemini 没有，因此默认不勾选。[panel.html:L398-L403](file:///c:/Users/ZhuanZ/Desktop/AI-RoundTable/src/sidepanel/panel.html#L398-L403)
- JS 侧只会读取 `checkbox.checked` 组装 targets 发送给后台，不会覆盖默认值，因此改 HTML 就能生效。[simulateBroadcast](file:///c:/Users/ZhuanZ/Desktop/AI-RoundTable/src/sidepanel/panel.js#L180-L215)

## 修改方案
- 将顶部 Gemini 的 checkbox 改为默认勾选：把
  - `<input type="checkbox"> Gemini`
  改为
  - `<input type="checkbox" checked> Gemini`
  修改位置：[panel.html:L398-L403](file:///c:/Users/ZhuanZ/Desktop/AI-RoundTable/src/sidepanel/panel.html#L398-L403)

## 验证方式
- 重新加载插件后打开 SidePanel：确认顶部 Gemini 默认处于勾选状态。
- 点击 Broadcast：确认发出的 targets 数组包含 `Gemini`（可通过后台日志/现有状态更新链路间接确认）。

## 可选增强（如果你确实想“Sequential Thinking MCP”落地到 UI）
- 在 Router Dock 的预设指令里新增一个“Sequential Thinking”胶囊：把对应提示词加入 [panel.js](file:///c:/Users/ZhuanZ/Desktop/AI-RoundTable/src/sidepanel/panel.js) 的 `PRESETS`，并在 [panel.html](file:///c:/Users/ZhuanZ/Desktop/AI-RoundTable/src/sidepanel/panel.html) 的 chips 区加一个按钮。