# Project Name: AI RoundTable Extension (The Boardroom)

## 1. 项目概述 (Overview)
我们要开发一个基于 Chrome Manifest V3 的浏览器插件，名为 **"AI RoundTable"** 。
**核心理念：** 将浏览器变成一个“多模型董事会”。用户作为董事长，利用已登录的 Web 版 ChatGPT、Claude 等 AI 模型作为董事会成员，进行复杂的商业决策。
**交互模式：** 非线性的“星型拓扑”控制台。支持广播提问、单独追问、提取观点（Quote）以及点对点/点对多的交叉辩论（Routing）。

## 2. 核心原则 (Core Principles)
1.  **原生架构 (Vanilla Architecture)** :
    *  不使用 Webpack, Vite, React, Vue。
    *  使用原生 HTML/CSS/JavaScript (ES Modules)。
    *  代码结构透明，易于手动修改和调试。
2.  **Human-in-the-Loop (半自动控制)** :
    *  不做全自动的黑盒循环。
    *  所有的“转发”和“辩论”操作都由用户在 SidePanel (侧边栏) 手动触发，确保用户掌控讨论方向。
3.  **ChatHub 参考策略** :
    * 仅参考 ChatHub 项目的 **DOM 操作逻辑** (适配器部分)，学习如何绕过 React 的输入限制。
    * **严禁** 照搬其复杂的 Store/MessageBus 架构。

## 3. UI 交互设计 (Control Panel Layout)
插件运行在浏览器的 **SidePanel** 中，界面分为上、中、下三层：

### 3.1 顶部：全局输入区 (Global Command)
* **多行输入框** : 用于输入 Prompt。
* **目标选择器 (Target Checkboxes)** :
    * `[ ] ChatGPT` `[ ] Claude` (动态检测 Tab 是否存在)
* **动作按钮**: `发送 (Send)`
* **逻辑** : 点击发送后，只向被勾选的 AI 发送消息。

### 3.2 中部：监控流 (Monitor Stream)
* 不显示完整的聊天记录，只显示 **"当前状态卡片" (Live Cards)** 。每个 AI 对应一张卡片。
* **卡片内容** :
    * **Header** : 模型名称 + 状态指示灯 (Idle/Generating/Error)。
    * **Body**: 最新一条回复的 **前100字摘要** 。
    * **Action**: 一个显眼的 **[引用 (Quote)]** 按钮。
* **逻辑** : 点击 [Quote] 按钮，会将该 AI 的完整回复文本提取并存入“底部路由区”。

### 3.3 底部：路由区 (Router Dock)
*  这是实现“交叉辩论”的核心。
* **引用预览框** : 显示被引用（Quote）的内容（例如：A 的方案）。
* **附加指令框** : 用户输入额外指令（例如：“请批判上述方案的风险”）。
* **分发目标** : 复选框选择要发送给谁（例如：发给 B, C, D）。
* **路由按钮**: `分发 (Route)` 。

## 4. 业务流程逻辑 (User Workflow)

### 场景一：尽职调查 (Broadcasting & Clarifying)
1.  用户在 **顶部** 输入：“我想投资石油，本金50万”。
2.  勾选 `ChatGPT` 和 `Claude`，点击 `发送` 。
3.  插件自动在后台控制两个 Tab 输入并发送。
4.  **中部卡片** 实时更新状态，显示 AI 提出的反问（如：“做多还是做空？”）。
5.  用户可以只勾选 `ChatGPT` 回复它的追问，或者勾选全部进行广播回复。

### 场景二：交叉辩论 (Cross-Fire / Sniper Mode)
1.  用户发现 ChatGPT 给出了一个激进的做多方案。
2.  用户在 ChatGPT 的卡片上点击 **[引用 (Quote)]** 。
3.  该方案内容自动填充到 **底部路由区** 。
4.  用户在 **底部** 的附加指令框输入：“这是另一个分析师的激进方案，请找出其中的死角，狠批。”
5.  用户在 **底部** 勾选 `Claude` (或其他 AI)，点击 `分发` 。
6.  插件将 "指令 + 引用内容" 组合，发送给 Claude。

### 场景三：最终汇总 (Synthesis)
1.  经过几轮互喷，观点趋同。
2.  用户点击 Claude 卡片的 **[引用]** （假设 Claude 总结得最好）。
3.  在 **底部** 勾选 `ChatGPT` ，输入指令：“这是最终定稿的思路，请把它整理成一份正式的 PDF 格式文档结构。”
4.  发送。

## 5. 技术架构规范 (Technical Specs)

### 5.1 目录结构
```text
/
├── manifest.json
├── reference/                  // 参考资料目录
│   └── chathub/                // ChatHub 源码 (参考其 DOM 操作逻辑)
├── src/
│   ├── background/
│   │   └── service_worker.js   // 核心大脑：维护 Tab 列表，处理消息路由
│   ├── content/
│   │   ├── adapter_base.js     // DOM 操作基类 (参考 ChatHub)
│   │   ├── adapter_gpt.js      // ChatGPT 实现
│   │   └── adapter_claude.js   // Claude 实现
│   ├── sidepanel/
│   │   ├── panel.html          // 控制台界面
│   │   ├── panel.css
│   │   └── panel.js            // UI 逻辑 + 状态管理
│   └── utils/
│       └── storage.js          // 封装 chrome.storage.local
```

### 5.2 数据存储 Schema (chrome.storage.local)
我们需要共享状态，以便 SidePanel 和 Background 同步。
```javascript
{
  "active_tabs": {             // 已连接的 Tab 信息
    "gpt": { "tabId": 123, "status": "idle", "lastReply": "..."  },
    "claude": { "tabId": 124, "status": "generating", "lastReply": "..."  }
  },
  "router_buffer": {           // 剪贴板/路由区内容
    "source": "ChatGPT" ,
    "text": "建议全仓买入..."
  }
}
```

### 5.3 关键技术点
*   **Tab Discovery** : Background script 需要在插件启动时，查询 ( `chrome.tabs.query` ) 是否存在匹配 `chatgpt.com` 和 `claude.ai` 的 Tab，并建立长连接。
*   **Input Simulation** : 必须实现一个 `simulateUserInput(element, text)` 函数，能够触发 React/Vue 侦听的 `input`, `change`, `bubbles` 事件。
*   **Observation** : 使用 `MutationObserver` 监听 DOM 变化以更新 SidePanel 的“最新回复摘要”。
