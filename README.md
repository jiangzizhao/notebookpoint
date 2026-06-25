# NotebookPoint

把你在微信里转发的文章、链接、资料,**自动同步成 Obsidian 笔记(带全文)**。

本仓库是 NotebookPoint 的 **Obsidian 插件(客户端,开源)**。它凭你的卡密,把你转发的内容拉进 vault、写成 Markdown 笔记。**不含任何密钥**;内容的接收 / 解析 / 存储由托管服务完成。

- 📥 **微信转发 → 自动进 Obsidian**:看到好文章 / 链接,转发给客服,自动变成你的笔记
- 🔄 **自动同步**:打开 Obsidian 自动拉取,也可定时同步,零手动
- 🔒 **隐私**:插件开源(不偷传数据),你的卡密只存在你自己电脑上

## 安装与使用

1. 按[图文教程](https://api.monoi.cn/nbp/guide)安装插件
2. 在插件设置里填入你的**卡密**
3. 微信里加「**obsidian**」客服,把卡密发给它激活
4. 之后你转发的文章 / 链接,会自动同步进 Obsidian 🎉

## 购买

关注公众号 **【monoi.cn】**,回复「obsidian」获取卡密(¥9.9 / 年)。

<img width="480" alt="公众号二维码" src="https://github.com/user-attachments/assets/8bf22967-c36d-424f-aad3-5b179b425347" />

## 构建

```bash
npm install
npm run build   # 产物 main.js
```

## License

MIT
