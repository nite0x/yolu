import {before, test} from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {JSDOM} from "jsdom";

let bundle = "";
before(async () => {
  const result = await build({entryPoints: ["frontend/chat/voice-input.ts"], bundle: true, write: false, format: "iife", globalName: "VoiceTest"});
  bundle = result.outputFiles[0].text + "\nwindow.VoiceTest = VoiceTest;";
});

function fixture() {
  const dom = new JSDOM('<meta name="csrf-token" content="test-token">', {url: "http://localhost", runScripts: "dangerously"});
  const w = dom.window as any;
  const requests: {path: string; options: RequestInit}[] = [];
  const states: string[] = [], transcripts: string[] = [], errors: string[] = [];
  let microphone: any;
  const track = {enabled: true, stops: 0, stop() {this.stops++;}, addEventListener() {}};
  const stream = {getTracks: () => [track]};
  const channel = {readyState: "open", sent: [] as string[], onmessage: undefined as any, onclose: undefined as any,
    send(value: string) {this.sent.push(value);}, close() {this.readyState = "closed"; this.onclose?.();}};
  class Peer {
    iceGatheringState = "complete";
    localDescription = {type: "offer", sdp: "v=0\r\nm=audio"};
    connectionState = "new";
    addTrack() {}
    createDataChannel() {return channel;}
    async createOffer() {return this.localDescription;}
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {this.connectionState = "closed";}
  }
  Object.assign(w, {RTCPeerConnection: Peer, fetch: async (path: string, options: RequestInit) => {
    requests.push({path, options});
    if (options.method === "DELETE") return new Response(null, {status: 204});
    return new Response(JSON.stringify({id: "voice-session", sdp: "answer"}), {status: 201});
  }});
  Object.defineProperty(w.navigator, "mediaDevices", {value: {getUserMedia: () => microphone || Promise.resolve(stream)}, configurable: true});
  w.eval(bundle);
  const session = new w.VoiceTest.CodexVoiceInput({state: (value: string) => states.push(value), transcript: (value: string) => transcripts.push(value), error: (value: string) => errors.push(value)});
  const message = (event: unknown) => channel.onmessage({data: JSON.stringify(event)});
  return {w, session, states, transcripts, errors, requests, track, stream, channel, message,
    microphone(value: Promise<unknown>) {microphone = value;}, dispose() {session.cancel(); w.close();}};
}

test("Codex WebRTC signaling uses the local authenticated API and appends only unique input transcripts", async () => {
  const h = fixture();
  try {
    await h.session.start();
    assert.equal(h.track.enabled, false);
    assert.equal(h.requests[0].path, "/api/voice/sessions");
    assert.equal((h.requests[0].options.headers as Record<string, string>)["X-CSRF-Token"], "test-token");
    h.message({type: "session.started"});
    assert.equal(h.track.enabled, true);
    h.message({type: "input_transcript.added", item: {id: "one", text: "语音"}});
    h.message({type: "input_transcript.added", item: {id: "one", text: "语音"}});
    h.message({type: "output_transcript.added", item: {id: "reply", text: "自动回答"}});
    h.message({type: "delegation.created", item: {content: [{text: "执行任务"}]}});
    h.message({type: "turn.done", turn: {role: "user", transcript: "语音"}});
    assert.deepEqual(h.transcripts, ["语音"]);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.states, ["connecting", "listening"]);
    assert.deepEqual(h.errors, []);
  } finally {h.dispose();}
});

test("stopping releases the microphone immediately and receives trailing fragments until confirmed close", async () => {
  const h = fixture();
  try {
    await h.session.start();
    h.message({type: "session.started"});
    h.session.stop();
    h.session.stop();
    assert.equal(h.track.stops, 1);
    assert.equal(h.states.at(-1), "finishing");
    assert.deepEqual(h.channel.sent.map(value => JSON.parse(value)), [{type: "session.close"}]);
    h.message({type: "input_transcript.added", item: {id: "tail", text: "最后一句"}});
    h.message({type: "session.closed"});
    h.message({type: "input_transcript.added", item: {id: "late", text: "已结束"}});
    assert.deepEqual(h.transcripts, ["最后一句"]);
    assert.equal(h.states.at(-1), "idle");
    assert.equal(h.requests.at(-1)?.options.method, "DELETE");
    assert.deepEqual(h.errors, []);
  } finally {h.dispose();}
});

test("cancelling while microphone permission is pending stops tracks when permission resolves", async () => {
  const h = fixture();
  try {
    let resolve!: (value: unknown) => void;
    h.microphone(new Promise(done => {resolve = done;}));
    const starting = h.session.start();
    h.session.cancel();
    resolve(h.stream);
    await starting;
    assert.equal(h.track.stops, 1);
    assert.equal(h.requests.length, 0);
    assert.equal(h.states.at(-1), "idle");
  } finally {h.dispose();}
});

test("cancelled signaling releases a server session even if its response arrives after cancellation", async () => {
  const h = fixture();
  try {
    let resolve!: (value: Response) => void;
    h.w.fetch = (path: string, options: RequestInit) => {
      h.requests.push({path, options});
      if (options.method === "DELETE") return Promise.resolve(new Response(null, {status: 204}));
      return new Promise(done => {resolve = done;});
    };
    const starting = h.session.start();
    while (!resolve) await new Promise(done => setTimeout(done, 1));
    h.session.cancel();
    resolve(new Response(JSON.stringify({id: "late-session", sdp: "answer"}), {status: 201}));
    await starting;
    assert.equal(h.requests.at(-1)?.path, "/api/voice/sessions/late-session");
    assert.equal(h.requests.at(-1)?.options.method, "DELETE");
    assert.deepEqual(h.errors, []);
  } finally {h.dispose();}
});

test("microphone denial and Codex startup failures are visible and leave no recording running", async () => {
  for (const denied of [true, false]) {
    const h = fixture();
    try {
      if (denied) h.w.navigator.mediaDevices.getUserMedia = async () => {throw new h.w.DOMException("denied", "NotAllowedError");};
      else h.w.fetch = async () => new Response(JSON.stringify({error: "Codex login required"}), {status: 502});
      await h.session.start();
      assert.equal(h.states.at(-1), "idle");
      assert.match(h.errors[0], denied ? /麦克风/ : /Codex login required/);
      if (!denied) assert.ok(h.track.stops > 0);
    } finally {h.dispose();}
  }
});

test("Linux desktop dictation reuses Codex native capture and its authenticated transcript stream", async () => {
  const h = fixture();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  try {
    h.w.document.documentElement.setAttribute('data-workhub-platform', 'linux');
    h.w.RTCPeerConnection = undefined;
    Object.assign(h.w, {TextDecoder, TextEncoder, ReadableStream});
    const body = new ReadableStream<Uint8Array>({start(controller) {stream = controller;}});
    h.w.fetch = async (path: string, options: RequestInit) => {
      h.requests.push({path, options});
      if (path === '/api/voice/native/sessions') return new Response(body, {headers: {'Content-Type': 'text/event-stream'}});
      return new Response(null, {status: 204});
    };
    const send = (event: unknown) => stream.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));
    const starting = h.session.start();
    send({id: 'native-session', state: 'listening'});
    send({text: '原生听写'});
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(h.transcripts, ['原生听写']);
    assert.equal(h.states.at(-1), 'listening');
    assert.equal(h.track.stops, 0);
    h.session.stop();
    assert.equal(h.states.at(-1), 'finishing');
    send({text: '最后一段'});
    send({state: 'idle'});
    stream.close();
    await starting;
    assert.deepEqual(h.transcripts, ['原生听写', '最后一段']);
    assert.ok(h.requests.some(request => request.path === '/api/voice/native/sessions/native-session/stop'));
    assert.ok(h.requests.some(request => request.path === '/api/voice/sessions/native-session' && request.options.method === 'DELETE'));
    assert.deepEqual(h.errors, []);
  } finally {h.dispose();}
});
