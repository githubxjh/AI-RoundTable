# 禁用模型排序优化方案

## 本轮执行锁定

> 文档状态：本轮只优化方案文档，不改代码。下面提到的代码、测试和文件路径只作为接手 AI 的实现边界。

### 推荐方案

固定采用 **方案一：手动重排 HTML + 调整 `DISPLAY_MODELS`**：

- 当前只把 Claude 这个禁用模型移到列表末尾。
- 只调整显示顺序，不改变启用/禁用判断。
- 让视觉顺序、DOM 顺序、Tab 键顺序和读屏顺序保持一致。

### 不要做什么

- 不做 JS 动态模板化；当前只有 Claude 一个禁用模型，抽象收益不够。
- 不用 CSS `order` 做视觉假排序，因为会造成视觉顺序与 DOM/键盘/读屏顺序不一致。
- 不改 `ENABLED_MODELS` / `DISABLED_MODELS` 的业务含义。
- 不恢复 Claude，不新增 Claude 相关自动化能力。

### 实现注意事项

- 同步调整 `DISPLAY_MODELS` 和 `panel.html` 中 4 处静态列表，避免数据源顺序与 DOM 顺序不一致。
- 保留 Claude 的禁用样式、禁用文案和禁用按钮状态。
- 回应评审的被评对象下拉已经过滤禁用模型，只需要验证不出现 Claude，不需要改逻辑。
- 验收由代码执行方完成；本文档只记录测试要求，不在本轮执行测试。

## 现状

Claude 模型被标记为禁用（`DISABLED_MODELS = ['Claude']`），但所有 UI 列表中 Claude 都排在第二位（ChatGPT 之后），穿插在可用模型中间。

### 受影响的 UI 位置（共 7 处）

| # | 位置 | 类型 | 当前顺序 | 文件:行 |
|---|------|------|---------|---------|
| 1 | 群发目标选择 | HTML 静态 checkbox | ChatGPT → **Claude** → Grok → ... | [panel.html:726-731](src/sidepanel/panel.html#L726) |
| 2 | AI 应答卡片区 | HTML 静态卡片 | ChatGPT → **Claude** → Grok → ... | [panel.html:737-806](src/sidepanel/panel.html#L737) |
| 3 | 路由目标选择 | HTML 静态 checkbox | ChatGPT → **Claude** → Grok → ... | [panel.html:867-872](src/sidepanel/panel.html#L867) |
| 4 | 评委模型选择 | HTML 静态 checkbox | ChatGPT → **Claude** → Grok → ... | [panel.html:902-907](src/sidepanel/panel.html#L902) |
| 5 | 卡片渲染顺序 | JS 数组 `DISPLAY_MODELS` | `['ChatGPT','Claude','Grok',...]` | [panel.js:27](src/sidepanel/panel.js#L27) |
| 6 | 回应评审-被评对象下拉 | JS 动态渲染 | 已过滤掉禁用模型 ✅ | [panel.js:1030](src/sidepanel/panel.js#L1030) |
| 7 | 引用列表 | JS 动态渲染 | 按添加时间排序 | [panel.js:875](src/sidepanel/panel.js#L875) |

> 注：第 6 处（被评对象下拉）已经通过 `isEnabledModel()` 过滤掉 Claude，无需改动。第 7 处（引用列表）按用户操作顺序排列，Claude 理论上不会出现（因为 Claude 卡片上的引用按钮本身是 disabled 的）。

### 问题

Claude 卡在列表中间，用户每次选择目标、查看卡片、选评委时都要视觉跳过这个不可用的项。有 4 个 checkbox 组 + 1 个卡片区共 5 处需要改。

---

## 方案一：纯静态调整——手动重排 HTML + 改数组

**做法：**

1. `panel.js` 第 27 行：`DISPLAY_MODELS` 把 Claude 移到最后
2. `panel.html` 中 4 处静态列表：把 Claude 的 DOM 节点剪切到末尾

**改动量：** 1 处 JS + 4 处 HTML，约 30 行位移。

**优势：**
- 零逻辑改动，零风险
- 不需要新增排序函数，直接改顺序即可
- 改动即生效，不依赖 JS 执行

**劣势：**
- HTML 中有 4 处重复的模型列表，手动改容易漏
- 将来如果新增/调整模型列表位置，仍需手动维护
- 如果以后有其他模型被禁用（不只是 Claude），还得再手动调一次

**适用判断：** 最快的止血方案。如果禁用模型只有 Claude 且短期内不会变化，这是最简单路径。

---

## 方案二：JS 动态排序 + HTML 模板化

**做法：**

1. 新增一个 `getSortedDisplayModels()` 函数，返回 `[...ENABLED_MODELS, ...DISABLED_MODELS]`，保证可用模型在前、禁用模型在后
2. 4 处静态 HTML checkbox 列表改为 JS 动态渲染（`innerHTML`），从排序后的数组生成
3. AI 卡片区保持 HTML 静态结构（卡片有复杂内部结构和 id 映射），但用 CSS `order` 或 JS `appendChild` 重排

**改动量：** 约 60 行 JS + 删 20 行 HTML，净增约 40 行。

**优势：**
- 一处定义排序规则，所有列表自动跟随
- 如果将来禁用/启用模型变化，只需改 `ENABLED_MODELS` / `DISABLED_MODELS` 数组，所有 UI 自动更新
- checkbox 列表统一由 JS 渲染，消除 HTML 中的 4 处重复硬编码

**劣势：**
- checkbox 列表从静态 HTML 改成动态渲染，改动面稍大
- 需要处理初始勾选状态（有些默认 checked，有些不 checked，当前写在 HTML 里）
- AI 卡片区结构复杂（有 id、内部按钮、多语言属性），不适合完全动态渲染，需单独处理

**适用判断：** 适合作为长期方案。如果未来可能调整模型列表（增减模型、调整禁用状态），投入值得。

---

## 方案三：CSS Flexbox Order——纯样式方案

**做法：**

给每个 checkbox label / AI 卡片加一个 CSS 类标识是否禁用，然后用 flexbox `order` 把禁用的推到末尾。

```css
.checkbox-row { display: flex; flex-wrap: wrap; }
.checkbox-label.disabled { order: 999; }
#monitor-stream { display: flex; flex-direction: column; }
.ai-card.disabled { order: 999; }
```

`panel.js` 中只需在 `renderCards()` 确保 Claude 卡片有 `.disabled` 类（目前已有，[panel.js:1423](src/sidepanel/panel.js#L1423)）。

**改动量：** 约 10 行 CSS + 确保 `.disabled` 类正确设置（基本已有）。

**优势：**
- 改动极小，几乎零风险
- 不改 HTML 结构，不改 JS 逻辑
- checkbox label 已经有 `.disabled` 类（如 `panel.html:868`），AI 卡片在 `renderCards` 时也会加 `.disabled` 类（`panel.js:1423`）

**劣势：**
- CSS `order` 只影响视觉顺序，不影响 DOM 顺序——屏幕阅读器和 Tab 键导航仍按 DOM 顺序
- 如果 flex 容器不是垂直排列（如 checkbox row 是水平折行），`order: 999` 只影响同行内的位置，不一定推到"最后一行"
- 是一种"看起来解决了"的方案，对无障碍访问不友好

**适用判断：** 如果你想花 5 分钟快速改善视觉效果，且不在意无障碍场景，可以用这个方案。但不推荐作为最终方案。

---

## 方案对比

| 维度 | 方案一 手动重排 | 方案二 JS 动态排序 | 方案三 CSS order |
|------|:---:|:---:|:---:|
| 实现工时 | 15 min | 1-2 h | 5 min |
| 改动文件 | 2 (js+html) | 2 (js+html) | 1-2 (css+js) |
| 长期可维护性 | 差（硬编码 4 处） | 好（单点排序） | 中（依赖 CSS 结构） |
| 无障碍友好 | ✅ | ✅ | ❌ DOM 顺序不变 |
| Tab 键导航顺序 | 正确 | 正确 | 仍按 DOM 顺序 |
| 复选框初始状态处理 | 无需改动 | 需 JS 接管 | 无需改动 |
| 模型增减时 | 需手动改4处 | 仅改数组定义 | CSS 自动适配 |

---

## 建议

推荐**方案一（手动重排）**作为当前最佳选择。理由：

1. 当前禁用的只有 Claude 一个模型，且短期内不会变化——方案二的"灵活性"在当前场景下是用不到的
2. 15 分钟改完，零逻辑风险
3. 方案三的 CSS `order` 虽然在视觉上有效，但会让 Tab 导航和屏幕阅读器仍按旧顺序，造成行为和视觉不一致
4. 如果以后模型列表频繁变动，再从方案一升级到方案二也很容易（那时 checkbox 已经是正确顺序，只需把 HTML 提取为 JS 生成）

### 具体改动清单

**panel.js（1 处）：**
- 第 27 行：`DISPLAY_MODELS` 改为 `['ChatGPT', 'Grok', 'Gemini', 'Doubao', 'DeepSeek', 'Claude']`

**panel.html（4 处）：**
- 第 726-731 行（群发目标）：Claude 的 label 移到 DeepSeek 之后
- 第 749-758 行（AI 卡片 `#card-claude`）：整个 div 移到 `#card-deepseek` 之后
- 第 867-872 行（路由目标）：Claude 的 label 移到 DeepSeek 之后
- 第 902-907 行（评委模型）：Claude 的 label 移到 DeepSeek 之后

---

## 实现要点（给接手 AI 的 brief）

1. **只改顺序，不改结构**。每个 DOM 节点/数组元素的内容保持原样，只移动位置。

2. **先改 JS 数组**。`DISPLAY_MODELS` 是卡片渲染的数据源，改了它再改 HTML 可以保证两个来源的顺序一致。

3. **验证点**：
   - 群发面板：Claude checkbox 在列表最后，灰显不可选
   - 路由面板：同上
   - 评审面板：同上
   - 主界面卡片区：Claude 卡片在最下方，显示"已禁用"
   - 回应评审下拉：Claude 不出现在选项中（已过滤，验证保持不变）

4. **不要改**：
   - `ENABLED_MODELS` / `DISABLED_MODELS` 数组本身的顺序——它们只是逻辑判断用的集合，顺序无关
   - 回应评审下拉（已经正确过滤）
   - `isDisabledModel` / `isEnabledModel` 函数逻辑
