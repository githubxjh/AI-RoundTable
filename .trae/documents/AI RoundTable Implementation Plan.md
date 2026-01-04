# AI RoundTable 开发计划

根据对现有代码和需求文档 (PRD) 的审查，我制定了以下从“原型”到“功能实现”的开发计划：

## 第一阶段：修复与架构搭建 (Fix & Architecture)
**目标**：确保插件能正常加载，且各个组件（侧边栏、后台、网页）之间能互相通信。

1.  **重构侧边栏 (SidePanel)**
    *   **问题**：`panel.html` 包含了内联 JavaScript 代码（`<script>...</script>`），这违反了 Chrome 插件的安全策略 (CSP)，会导致无法运行。
    *   **行动**：将 `panel.html` 中的所有 JS 逻辑移动到 `src/sidepanel/panel.js` 文件中。
    *   **行动**：在 `panel.html` 中使用 `<script type="module" src="panel.js"></script>` 引入。

2.  **实现“神经系统” (消息通信)**
    *   **后台 (`service_worker.js`)**:
        *   实现 `findTargetTabs()`: 自动检测已打开的 `chatgpt.com` 和 `claude.ai` 标签页。
        *   实现 `chrome.runtime.onMessage` 监听器，负责消息路由：
            *   `BROADCAST` (广播): 侧边栏 -> 后台 -> 所有已连接的 AI 标签页。
            *   `ROUTE` (路由): 侧边栏 -> 后台 -> 指定的 AI 标签页。
    *   **侧边栏 (`panel.js`)**:
        *   将目前的 `alert()` 演示代码替换为真实的 `chrome.runtime.sendMessage()` 调用。

## 第二阶段：核心适配器实现 (Adapters)
**目标**：让插件能够真正控制 ChatGPT 和 Claude 网页进行输入和发送。

3.  **通用适配器 (`adapter_base.js`)**
    *   实现 `simulateUserInput(element, text)`: 这是最关键的部分。我们需要模拟真实的用户输入事件，以触发 React/Vue 的内部状态更新（参考 ChatHub 的实现）。
    *   实现 `monitorResponse(callback)`: 使用 `MutationObserver` 监听网页变化，获取 AI 的回复并发送回侧边栏。

4.  **平台专用适配器**
    *   **`adapter_gpt.js`**: 针对 ChatGPT 的输入框、发送按钮和回复区域的 DOM 选择器。
    *   **`adapter_claude.js`**: 针对 Claude 的 DOM 结构适配。

## 第三阶段：UI 与状态同步 (Sync)
**目标**：让“监控卡片”和“路由区”真正动起来。

5.  **状态管理**
    *   更新 `service_worker.js` 维护一个 `tabStatus` 映射表 (例如：空闲、生成中)。
    *   更新 `panel.js`，根据后台传来的实时数据渲染“Live Cards”。

6.  **路由功能 (Router)**
    *   实现“引用 (Quote)”流程：
        *   Content Script 提取文本 -> 发送给后台 -> 存入 `chrome.storage.local` -> 侧边栏读取并显示在“路由区”。

## 执行顺序
我将从 **第一阶段** 开始，先打通通信链路，然后进入 **第二阶段** 实现核心的网页控制逻辑。
