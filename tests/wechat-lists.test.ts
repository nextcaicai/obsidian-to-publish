// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyPlatformProfile, wrapPlatformFragment } from "../src/platforms/profiles";
import { normalizeWechatDraftHtml } from "../src/publishing/wechat-official";

function render(html: string) {
	const root = document.createElement("div");
	root.innerHTML = html;
	applyPlatformProfile(root, "wechat");
	return root;
}

describe("WeChat list export", () => {
	it.each(["ul", "ol"])("keeps %s text explicitly at body size after loose paragraph removal", (tag) => {
		const root = render(`<${tag}><li style="font-size:15px"><p><strong>加粗</strong>：在文字两侧加放两个星号（<code>**加粗文字**</code>）</p></li></${tag}>`);
		expect(root.querySelector(tag)?.style.fontSize).toBe("16px");
		expect(root.querySelector("li")?.style.fontSize).toBe("16px");
		const content = root.querySelector("li > span");
		expect(content).not.toBeNull();
		expect(content?.getAttribute("style")).toContain("font-size:16px");
		expect(content?.textContent).toBe("加粗：在文字两侧加放两个星号（**加粗文字**）");
		expect(content?.querySelector("strong")).not.toBeNull();
		expect(content?.querySelector("code")).not.toBeNull();
		expect(root.querySelector("li > p")).toBeNull();
		const draft = normalizeWechatDraftHtml(wrapPlatformFragment(root.innerHTML, "wechat"));
		expect(draft).toContain(content!.outerHTML);
	});

	it("groups tight-list inline nodes and removes inherited layout overrides", () => {
		const root = render('<ul style="display:flex"><li style="display:flex"><strong style="display:block">加粗</strong>：说明 <em>斜体</em> <a href="https://example.com" style="font-size:15px">链接</a><br>换行</li></ul>');
		expect(root.querySelector("ul")?.style.display).toBe("block");
		expect(root.querySelector("li")?.style.display).toBe("list-item");
		expect(root.querySelector("strong")?.style.display).toBe("inline");
		expect(root.querySelector("a")?.style.fontSize).toBe("16px");
		expect(root.querySelector("li > span")?.textContent).toBe("加粗：说明 斜体 链接换行");
		expect(root.querySelector("li > span > br")).not.toBeNull();
	});

	it("preserves nested numbering, multiple paragraphs, code blocks, media and task markers", () => {
		const root = render('<ol start="3"><li><p>父项</p><ul><li><em>子项</em>说明</li></ul></li><li value="8"><p>第一段</p><p>第二段</p><pre><code>one\ntwo</code></pre><img src="https://example.com/a.png"></li><li class="task-list-item" style="list-style-type:none">☑ 已完成</li><li> </li></ol>');
		expect(root.querySelector("ol")?.getAttribute("start")).toBe("3");
		expect(Array.from(root.querySelector("li[value='8']")!.children).filter((child) => child.tagName === "P")).toHaveLength(2);
		expect(root.querySelector("li > ul > li > span")?.textContent).toBe("子项说明");
		expect(root.querySelector("pre code")?.textContent).toBe("one\ntwo");
		expect(root.querySelector("img")).not.toBeNull();
		expect(root.querySelector<HTMLElement>(".task-list-item")?.style.listStyleType).toBe("none");
		expect(root.querySelectorAll("li")).toHaveLength(4);
	});

	it("does not add content wrappers when a profile is applied again", () => {
		const root = render('<ul><li><strong>加粗</strong>：说明</li></ul>');
		applyPlatformProfile(root, "wechat");
		expect(root.querySelectorAll(".wechat-list-content")).toHaveLength(1);
	});

	it("does not change other platforms' list structures", () => {
		const root = document.createElement("div");
		root.innerHTML = '<ul><li><strong>加粗</strong>：说明</li></ul>';
		applyPlatformProfile(root, "zhihu");
		expect(root.querySelector(".wechat-list-content")).toBeNull();
		expect(root.querySelector("li > strong")?.textContent).toBe("加粗");
	});
});
