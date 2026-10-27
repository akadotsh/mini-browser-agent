const bridgePage = chrome.runtime.getURL("bridge.html");
let creatingBridge;

async function ensureBridge() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [bridgePage] });
  if (contexts.length) return;
  if (!creatingBridge) {
    creatingBridge = chrome.offscreen.createDocument({
      url: "bridge.html",
      reasons: ["LOCAL_STORAGE"],
      justification: "Keep connection status for the local browser-agent bridge in the extension page.",
    }).finally(() => { creatingBridge = undefined; });
  }
  await creatingBridge;
}

chrome.alarms.get("mini-browser-agent-bridge").then(alarm => {
  if (!alarm) chrome.alarms.create("mini-browser-agent-bridge", { periodInMinutes: 0.5 });
});
chrome.alarms.onAlarm.addListener(() => { void ensureBridge(); });
chrome.runtime.onStartup.addListener(() => { void ensureBridge(); });
chrome.runtime.onInstalled.addListener(() => { void ensureBridge(); });
void ensureBridge();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "background" || sender.url !== bridgePage) return;
  if (message.type === "request") {
    dispatch(message.request).then(
      result => sendResponse({ id: message.request.id, result }),
      error => sendResponse({ id: message.request.id, error: String(error?.message || error) }),
    );
    return true;
  }
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId === undefined) return;
  if (method.startsWith("Network.")) {
    if (method === "Network.requestWillBeSent") params = { requestId: params.requestId, request: { url: params.request.url, method: params.request.method }, type: params.type };
    else if (method === "Network.responseReceived") params = { requestId: params.requestId, response: { url: params.response.url, status: params.response.status, mimeType: params.response.mimeType } };
    else if (method === "Network.loadingFailed") params = { requestId: params.requestId, errorText: params.errorText };
    else if (method === "Network.loadingFinished") params = { requestId: params.requestId, encodedDataLength: params.encodedDataLength };
    else return;
  }
  void chrome.runtime.sendMessage({ target: "bridge", data: { type: "event", tabId: source.tabId, method, params } });
});

async function groupAgentTab(tab) {
  const [group] = await chrome.tabGroups.query({ title: "Agent", windowId: tab.windowId });
  const groupId = group
    ? await chrome.tabs.group({ tabIds: [tab.id], groupId: group.id })
    : await chrome.tabs.group({ tabIds: [tab.id] });
  await chrome.tabGroups.update(groupId, { title: "Agent", color: "blue" });
}

async function openTab() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = await chrome.tabs.create({ windowId: active?.windowId, active: true, url: "about:blank" });
  await groupAgentTab(tab);
  await chrome.debugger.attach({ tabId: tab.id }, "1.3");
  await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.enable");
  await chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.enable");
  await chrome.debugger.sendCommand({ tabId: tab.id }, "Network.enable");
  return { tabId: tab.id, url: tab.url || "about:blank", title: tab.title || "" };
}

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Page load timed out")), 20_000);
    const listener = (source, method) => {
      if (source.tabId === tabId && method === "Page.loadEventFired") finish();
    };
    function finish(error) {
      clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(listener);
      error ? reject(error) : resolve();
    }
    chrome.debugger.onEvent.addListener(listener);
  });
}

async function evaluate(tabId, expression) {
  const response = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Page evaluation failed");
  return response.result?.value;
}

async function dispatch({ method, tabId, params = {} }) {
  if (method === "open") return openTab();
  if (method === "navigate" || method === "reload") {
    const loaded = waitForLoad(tabId);
    if (method === "navigate") await chrome.tabs.update(tabId, { url: params.url });
    else await chrome.tabs.reload(tabId);
    await loaded;
    return evaluate(tabId, "({url:location.href,title:document.title})");
  }
  if (method === "evaluate") return evaluate(tabId, params.expression);
  if (method === "click") {
    const point = { x: params.x, y: params.y, button: "left", clickCount: 1 };
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { ...point, type: "mousePressed" });
    return chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { ...point, type: "mouseReleased" });
  }
  if (method === "type") return chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: params.text });
  if (method === "press") {
    const special = { Enter: ["Enter", 13], Tab: ["Tab", 9], Escape: ["Escape", 27], Backspace: ["Backspace", 8], Delete: ["Delete", 46], Space: [" ", 32], ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39], ArrowUp: ["ArrowUp", 38], ArrowDown: ["ArrowDown", 40], Home: ["Home", 36], End: ["End", 35], PageUp: ["PageUp", 33], PageDown: ["PageDown", 34] };
    const [key, keyCode] = special[params.key] || [params.key, params.key.charCodeAt(0)];
    const code = params.key === "Space" ? "Space" : /^[a-z]$/i.test(params.key) ? `Key${params.key.toUpperCase()}` : params.key;
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { ...base, type: "keyDown", text: params.key.length === 1 ? params.key : undefined });
    return chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  }
  if (method === "scroll") {
    const { width, height } = await evaluate(tabId, "({width:innerWidth,height:innerHeight})");
    return chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mouseWheel", x: width / 2, y: height / 2, deltaX: params.x, deltaY: params.y });
  }
  if (method === "screenshot") {
    const { format, quality } = params;
    return (await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", { format, quality, captureBeyondViewport: false })).data;
  }
  if (method === "detach") {
    await chrome.debugger.detach({ tabId }).catch(() => {});
    return true;
  }
  throw new Error(`Unsupported Chrome command: ${method}`);
}
