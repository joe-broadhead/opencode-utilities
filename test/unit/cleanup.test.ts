import { describe, expect, test } from "vitest"
import { cleanup } from "../../src/modules/speech/cleanup.js"

// Input, style and the text the speech engine's rules provider (aurum 8e3b70f) returned for it before cleanup moved
// to TypeScript. The port must keep giving the same text.
const ENGINE: readonly (readonly [text: string, style: "raw" | "clean" | "bullets" | "professional" | "summary", expected: string])[] = [
  ["um, hello there you know. I'm gonna go","raw","um, hello there you know. I'm gonna go"],
  ["um, hello there you know. I'm gonna go","clean","Hello there I'm gonna go."],
  ["um, hello there you know. I'm gonna go","bullets","• Hello there I'm gonna go."],
  ["um, hello there you know. I'm gonna go","professional","Hello there I am going to go."],
  ["um, hello there you know. I'm gonna go","summary","Hello there I'm gonna go."],
  ["First paragraph um here.\n\nSecond paragraph uh there.","raw","First paragraph um here.\n\nSecond paragraph uh there."],
  ["First paragraph um here.\n\nSecond paragraph uh there.","clean","First paragraph here.\n\nSecond paragraph there."],
  ["First paragraph um here.\n\nSecond paragraph uh there.","bullets","• First paragraph here\n• Second paragraph there"],
  ["First paragraph um here.\n\nSecond paragraph uh there.","professional","First paragraph here.\n\nSecond paragraph there."],
  ["First paragraph um here.\n\nSecond paragraph uh there.","summary","First paragraph here.\n\nSecond paragraph there."],
  ["I'd like that","raw","I'd like that"],
  ["I'd like that","clean","I'd like that."],
  ["I'd like that","bullets","• I'd like that."],
  ["I'd like that","professional","I'd like that."],
  ["I'd like that","summary","I'd like that."],
  ["we can't do it, we won't do it, they're sure","raw","we can't do it, we won't do it, they're sure"],
  ["we can't do it, we won't do it, they're sure","clean","We can't do it, we won't do it, they're sure."],
  ["we can't do it, we won't do it, they're sure","bullets","• We can't do it\n• We won't do it\n• They're sure"],
  ["we can't do it, we won't do it, they're sure","professional","We cannot do it, we will not do it, they are sure."],
  ["we can't do it, we won't do it, they're sure","summary","We can't do it, we won't do it, they're sure."],
  ["  spaced   out\ttext , with  gaps .  ","raw","spaced   out\ttext , with  gaps ."],
  ["  spaced   out\ttext , with  gaps .  ","clean","Spaced out\ttext, with gaps."],
  ["  spaced   out\ttext , with  gaps .  ","bullets","• Spaced out\ttext, with gaps."],
  ["  spaced   out\ttext , with  gaps .  ","professional","Spaced out\ttext, with gaps."],
  ["  spaced   out\ttext , with  gaps .  ","summary","Spaced out\ttext, with gaps."],
  ["one, two, three, four","raw","one, two, three, four"],
  ["one, two, three, four","clean","One, two, three, four."],
  ["one, two, three, four","bullets","• One\n• Two\n• Three\n• Four"],
  ["one, two, three, four","professional","One, two, three, four."],
  ["one, two, three, four","summary","One, two, three, four."],
  ["Short one. A much longer second sentence here! Third? Fourth sentence is the longest of them all.","raw","Short one. A much longer second sentence here! Third? Fourth sentence is the longest of them all."],
  ["Short one. A much longer second sentence here! Third? Fourth sentence is the longest of them all.","clean","Short one. A much longer second sentence here! Third? Fourth sentence is the longest of them all."],
  ["Short one. A much longer second sentence here! Third? Fourth sentence is the longest of them all.","bullets","• Short one\n• A much longer second sentence here\n• Third\n• Fourth sentence is the longest of them all"],
  ["Short one. A much longer second sentence here! Third? Fourth sentence is the longest of them all.","professional","Short one. A much longer second sentence here! Third? Fourth sentence is the longest of them all."],
  ["Short one. A much longer second sentence here! Third? Fourth sentence is the longest of them all.","summary","Short one Fourth sentence is the longest of them all."],
  ["equal one. aaaa bbbb. cccc dddd. eeee ffff","raw","equal one. aaaa bbbb. cccc dddd. eeee ffff"],
  ["equal one. aaaa bbbb. cccc dddd. eeee ffff","clean","Equal one. Aaaa bbbb. Cccc dddd. Eeee ffff."],
  ["equal one. aaaa bbbb. cccc dddd. eeee ffff","bullets","• Equal one\n• Aaaa bbbb\n• Cccc dddd\n• Eeee ffff"],
  ["equal one. aaaa bbbb. cccc dddd. eeee ffff","professional","Equal one. Aaaa bbbb. Cccc dddd. Eeee ffff."],
  ["equal one. aaaa bbbb. cccc dddd. eeee ffff","summary","Equal one Eeee ffff."],
  ["line one\nline two\r\nline three","raw","line one\nline two\r\nline three"],
  ["line one\nline two\r\nline three","clean","Line one line two line three."],
  ["line one\nline two\r\nline three","bullets","• Line one line two line three."],
  ["line one\nline two\r\nline three","professional","Line one line two line three."],
  ["line one\nline two\r\nline three","summary","Line one line two line three."],
  ["_um_ um_ 9um um9 éum umé","raw","_um_ um_ 9um um9 éum umé"],
  ["_um_ um_ 9um um9 éum umé","clean","_Um_ um_ 9um um9 éum umé."],
  ["_um_ um_ 9um um9 éum umé","bullets","• _Um_ um_ 9um um9 éum umé."],
  ["_um_ um_ 9um um9 éum umé","professional","_Um_ um_ 9um um9 éum umé."],
  ["_um_ um_ 9um um9 éum umé","summary","_Um_ um_ 9um um9 éum umé."],
  ["straße ist schön. ǆemal test","raw","straße ist schön. ǆemal test"],
  ["straße ist schön. ǆemal test","clean","Straße ist schön. Ǆemal test."],
  ["straße ist schön. ǆemal test","bullets","• Straße ist schön\n• Ǆemal test"],
  ["straße ist schön. ǆemal test","professional","Straße ist schön. Ǆemal test."],
  ["straße ist schön. ǆemal test","summary","Straße ist schön. Ǆemal test."],
  ["😀 um emoji first. 🎉 party","raw","😀 um emoji first. 🎉 party"],
  ["😀 um emoji first. 🎉 party","clean","😀 Emoji first. 🎉 Party."],
  ["😀 um emoji first. 🎉 party","bullets","• 😀 Emoji first\n• 🎉 Party"],
  ["😀 um emoji first. 🎉 party","professional","😀 Emoji first. 🎉 Party."],
  ["😀 um emoji first. 🎉 party","summary","😀 Emoji first. 🎉 Party."],
  ["ASAP fyi YEAH yep nope","raw","ASAP fyi YEAH yep nope"],
  ["ASAP fyi YEAH yep nope","clean","ASAP fyi YEAH yep nope."],
  ["ASAP fyi YEAH yep nope","bullets","• ASAP fyi YEAH yep nope."],
  ["ASAP fyi YEAH yep nope","professional","As soon as possible for your information yes yes no."],
  ["ASAP fyi YEAH yep nope","summary","ASAP fyi YEAH yep nope."],
]

describe("speech cleanup rules", () => {
  test.each(ENGINE)("%j as %s gives the engine's text", (text, style, expected) => {
    expect(cleanup(text, style)).toEqual({ text: expected, style, provider: "rules" })
  })
  test("blank text gives empty text", () => {
    expect(cleanup(" \n\t ", "clean")).toEqual({ text: "", style: "clean", provider: "rules" })
  })
  test("fillers go, paragraphs stay, and ambiguous contractions are not expanded", () => {
    expect(cleanup("um, hello there", "clean").text.toLowerCase()).not.toContain("um")
    expect(cleanup("First paragraph um here.\n\nSecond paragraph uh there.", "clean").text).toContain("\n\n")
    expect(cleanup("I'd like that", "professional").text).toBe("I'd like that.")
  })
})
