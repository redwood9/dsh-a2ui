# A2UI 实时界面生成指南（render_ui 使用手册）

你可以通过 `render_ui` 工具在对话中生成**可交互的实时界面**，而不是纯文本。
界面以 A2UI v0.9 协议描述（JSON），客户端逐条消息增量渲染；同一画布可多次调用实现"边生成边显示"。

## 一、工作流

1. **规划**：判断何时用 UI——状态卡片（机票/天气/订单）、表单（带提交）、商品卡、选项选择、数据展示等。简单问答仍用文本。
2. **创建画布**：第一条消息必须是 `createSurface`。
3. **下发组件与数据**：`updateComponents`（结构）与 `updateDataModel`（数据）分离；组件可分批下发，客户端边收边渲染。
4. **增量更新**：继续用同一 `surfaceId` 调用 `render_ui`，追加组件或更新数据，已展示的卡片原地刷新。
5. **读取交互**：用户点击按钮后，调用 `read_ui_actions` 获取 action（含 context），再决定下一步（例如更新界面或执行任务）。

## 二、消息格式（envelope）

每次调用 `render_ui(surfaceId, messages)`，`messages` 为 envelope 数组。每条 envelope 恰含以下一种消息，且内部 `surfaceId` 与参数一致：

```json
{"version":"v0.9","createSurface":{"surfaceId":"weather","catalogId":"kuikly_a2ui_catalog.json","sendDataModel":true}}
{"version":"v0.9","updateComponents":{"surfaceId":"weather","components":[ ... ]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"weather","path":"/city","value":"深圳"}}
{"version":"v0.9","deleteSurface":{"surfaceId":"weather"}}
```

- `updateDataModel.path` 为 JSON Pointer；`path:"/"` 或缺省表示整体替换 dataModel。
- 组件为**平坦邻接表**：每个组件有唯一 `id`，容器通过 `children`/`child` 引用子组件 id；必须存在 id 为 `root` 的组件，渲染从 root 开始，其余组件可任意顺序到达。

## 三、组件目录（18 个标准组件）

| 组件 | 关键属性 | 说明 |
|---|---|---|
| `Text` | `text`（动态字符串）、`variant`: h1/h2/h3/h4/h5/caption/body | 所有文字必须用 Text |
| `Image` | `url`、`description`、`fit`: cover/contain/fill、`variant`: avatar | |
| `Icon` | `name` | 常用：check/close/add/search/star/heart/calendar/clock/location/flight/shoppingCart |
| `Button` | `child`（子组件 id，通常放 Text）、`variant`: default/primary/borderless、`action` | 点击产生 action |
| `Card` | `child` | 卡片容器 |
| `Column` / `Row` | `children`、`justify`: start/center/end/spaceBetween/spaceAround、`align`: start/center/end/stretch | 纵向/横向 flex 布局 |
| `List` | `children`、`direction`: vertical/horizontal | 列表，支持模板 children |
| `Tabs` | `tabs`: [{"title":"...","child":"组件id"}] | |
| `Modal` | `trigger`（触发组件 id）、`content`（内容组件 id） | 点击 trigger 弹出 |
| `Divider` | `axis`: horizontal/vertical | |
| `TextField` | `label`、`value`（建议绑定 `{"path":...}`）、`variant`: text/number/multiline、`validationRegexp` | 输入写回 dataModel |
| `CheckBox` | `label`、`value`（布尔绑定） | |
| `Slider` | `label`、`min`、`max`、`value`（数值绑定） | |
| `ChoicePicker` | `label`、`options`: [{"label","value"}]、`variant`: mutuallyExclusive/multiple、`displayStyle`: chips、`value` | 单选写回字符串，多选写回数组 |
| `DateTimeInput` | `label`、`value`、`enableDate`、`enableTime`、`min`、`max` | |
| `Video` / `AudioPlayer` | `url`、`description`（仅 AudioPlayer） | |

`children` 支持**模板列表**：`{"path":"/items","componentId":"itemTpl"}`——对 dataModel 中 `/items` 数组的每一项渲染 `itemTpl`，模板内的 `{"path":"/name"}` 绑定自动作用于当前项（等价 `/items/0/name`）。

## 四、数据绑定与内置函数

属性值可以是字面量，或：

```json
{"path":"/user/name"}                          // 绑定 dataModel
{"call":"formatCurrency","args":{"value":{"path":"/price"},"currency":"CNY"}}   // 函数调用
```

内置函数（args 内的值均可再嵌套 path/call）：

| 函数 | 参数 | 返回 |
|---|---|---|
| `formatString` | `value`：含 `${/path}` 占位的模板串，如 `"你好 ${/user/name}"` | 替换后的字符串 |
| `formatNumber` | `value`、`decimals?`、`grouping?`（默认 true，千分位） | 字符串 |
| `formatCurrency` | `value`、`currency?`（USD/EUR/GBP/JPY/CNY，默认 USD） | 如 `¥1,299.00` |
| `formatDate` | `value`（日期串）、`format`（如 `yyyy-MM-dd HH:mm`） | 字符串 |
| `pluralize` | `value`、`zero?`、`one?`、`other?` | 按数量选文案 |
| `required` | `value` | 布尔 |
| `regex` | `value`、`pattern` | 布尔 |
| `email` | `value` | 布尔 |
| `length` | `value`、`min?`、`max?` | 布尔 |
| `numeric` | `value`、`min?`、`max?` | 布尔 |
| `and` / `or` | `values`: [布尔绑定...] | 布尔 |
| `not` | `value` | 布尔 |
| `openUrl` | `url` | 用于 action，本地打开链接 |

## 五、styles 视觉扩展（可选）

每个组件可带 `styles` 对象定制原生视觉（Kuikly 扩展，客户端映射为 CSS）。常用：

```json
"styles": {
  "width": 320, "padding": 16, "marginTop": 8, "borderRadius": 12,
  "backgroundColor": "#F5F7FF",
  "backgroundLinearGradient": {"direction":"to-right","colorStops":[{"color":"#3A6DF0","stop":0},{"color":"#7A3FD8","stop":1}]},
  "boxShadow": {"offsetX":0,"offsetY":2,"radius":8,"color":"#33000000"},
  "fontSize": 14, "color": "#1F2329", "fontWeight": 600, "textAlign": "center"
}
```

- 数值尺寸单位为 dp（客户端按 px 渲染）；`fontSize`/`color` 等文本字段仅 `Text` 可用。
- `flex`、`margin*`、`padding*`、`alignSelf`、`opacity`、`transform`（rotate/scale/translate）等亦支持，完整字段见随附 catalog。

## 六、Action（用户交互回传）

```json
{"id":"buyBtn","component":"Button","variant":"primary","child":"buyText",
 "action":{"event":{"name":"buy","context":{"sku":"A-100","qty":{"path":"/order/qty"}}}}}
```

- 用户点击后，context 中的 path 绑定会被求值，事件进入回传队列；你通过 `read_ui_actions` 拉取到 `{"surfaceId":"...","name":"buy","context":{"sku":"A-100","qty":2}}`。
- context 用字面量表达静态值，用 `{"path":...}` 表达动态值。
- 打开链接用本地 action：`"action":{"call":"openUrl","args":{"url":"https://..."}}`，不回传。

## 七、完整示例（可交互订单卡）

```json
[
  {"version":"v0.9","createSurface":{"surfaceId":"order","catalogId":"kuikly_a2ui_catalog.json"}},
  {"version":"v0.9","updateDataModel":{"surfaceId":"order","path":"/","value":{"product":{"name":"机械键盘","price":399},"qty":1}}},
  {"version":"v0.9","updateComponents":{"surfaceId":"order","components":[
    {"id":"root","component":"Card","child":"col"},
    {"id":"col","component":"Column","children":["title","price","qty","btn"],"styles":{"padding":16}},
    {"id":"title","component":"Text","variant":"h3","text":{"path":"/product/name"}},
    {"id":"price","component":"Text","text":{"call":"formatCurrency","args":{"value":{"path":"/product/price"},"currency":"CNY"}},"styles":{"color":"#E64545","fontSize":18}},
    {"id":"qty","component":"Slider","label":"数量","min":1,"max":10,"value":{"path":"/qty"}},
    {"id":"btnText","component":"Text","text":"立即购买"},
    {"id":"btn","component":"Button","variant":"primary","child":"btnText",
     "action":{"event":{"name":"buy","context":{"name":{"path":"/product/name"},"qty":{"path":"/qty"}}}}}
  ]}}
]
```

随后用户拖动 Slider 改变数量，点击购买；你调用 `read_ui_actions(surfaceId="order")` 得到最新 `qty`，完成任务后可用 `updateDataModel` 把卡片更新为"已下单"。

## 八、规则与建议

- **先结构后细节**：第一批消息给出 root 骨架，后续批次补内容，用户可尽早看到界面。
- 每次调用 `messages` 不超过 200 条；大界面分批。
- 不要输出可执行代码、HTML 或 iframe——只能使用上述组件。
- 表单类界面务必把输入组件的 `value` 绑定到 dataModel，提交按钮的 context 用 path 引用这些值。
- 一张卡片用一个独立 `surfaceId`；更新旧卡片复用其 `surfaceId`。
- 文本回答与 UI 卡片可混用：先文字说明，再调用工具生成卡片。
