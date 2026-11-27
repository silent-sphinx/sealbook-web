/** Bodies the shared round-trip fixture saves, beyond the parse corpus. */
export const ROUNDTRIP_EXTRAS: string[] = [
  // Headings
  "", "   ", "\n\n", "# Title\n\nSome **bold** prose.", "# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f",
  "####### seven", "#nospace", "# closing ##", "# not#", "   ## indented", "    # code-ish",

  // Lists
  "- one\n- two", "1. one\n2. two", "5. five\n6. six", "3) three", "- [ ] todo\n- [x] done\n- [X] caps", "- [ ]", "- [ ] ",
  "- outer\n  - inner", "- [ ] parent\n      - child", "- [ ] task\n- plain\n- [x] task", "1. a\n- [ ] b\n1. c", "2. a\n3. [x] b\n4. c",
  "1. a\n    1. b\n        - c\n2. d", "- a\n\n- b\n\n\n- c", "- a\n\t- tabbed\n- b", "* star\n+ plus", "- a\n  - b\n\n  - c", "  - indented\n- out",
  "- l0\n  - l1\n    - l2\n      - l3\n        - l4\n          - l5\n            - l6\n              - l7\n                - l8",

  // Quotes
  "> quoted", "> - one\n> - two", "> a\nlazy", "> a\n> # h\n- b", "> > > > > > deep", ">", "> a\n>\n> b", "> ```\n> code\n> ```",

  // Code blocks
  "```js\nconst x = 1;\n```", "```\n```", "```\nplain text\n```", "````\n```\ninner\n```\n````", "~~~py\nx\n~~~", "```unterminated\nbody",
  "```\n\n\n```", "```\ntrailing   \n```", "``` spaced lang \nx\n```", "- ```\n  x\n  ```",

  // Tables
  "| a | b |\n| --- | --- |\n| 1 | 2 |", "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |", "| spans ||\n| --- | --- |\n| 1 | 2 |",
  "| a | b |\n| --- | --- |\n| up | 2 |\n|  | 4 |\n<!-- sealbook:table rs=1.0:2 -->", "| a |\n| --- |\n| 1 |\n<!-- sealbook:table h=1:64 -->",
  "| a | b |\n| --- | --- |\n| 1 | 2 |\n<!-- sealbook:table bg=0.0:amber,1.1:green -->",
  "| a | b | c |\n| --- | --- | --- |\n| wide || 3 |\n|  |  | 6 |\n<!-- sealbook:table h=0:40 bg=1.0:blue rs=1.0:2 -->",
  "| a |\n| --- |\n| 1 |\n<!-- sealbook:table bg=0.0:chartreuse -->", "| a |\n| --- |\n| 1 |\n<!-- sealbook:table h=1:-4 -->",
  "| a |\n| --- |\n| 1 |\n<!-- sealbook:table h=9:40 bg=7.7:red rs=0.0:9 -->", "| a | b |\n|---|---|\n| only |", "| a |\n| - |",
  "a | b\n--- | ---\n1 | 2 | 3", "| x \\| y | `a|b` |\n| --- | --- |\n| **bold** | [l](https://e.com) |",
  "| - x | # y | 1. z |\n| --- | --- | --- |\n|  | | > q |", "| a | b |\n| --- | --- |\n| ![p](attachment:1) | line  |",
  "> | a |\n> | --- |\n> | 1 |", "| a | b |\n| --- | --- |\n| 1 | 2 |\n<!-- sealbook:table rs=0.1:2,1.0:3 bg=1.1:red -->",

  // Rules
  "above\n\n---\n\nbelow", "***", "___", "- - -", "* * *", "--", "text\n---",

  // Marks
  "call `fn()` now", "see [docs](https://example.com/a)", "***both*** and ~~struck~~ and `code`", "**bold _both_**", "**`x`**",
  "[`code link`](https://e.com)", "~~**_all_**~~", "**a** **b**", "**a****b**", "*a **b** c*", "** padded **", "a ** ** b", "_a_ b_c_d _e",
  "a_b_c", "snake_case_name", "__init__ and __main__", "an _emphasis_ here", "_leading and [not a link", "2 * 3 * 4", "a*b*c", "**unclosed",
  "~~unclosed", "~single~", "~~~~", "a ``b ` c`` d", "`` ` ``", "` spaced `", "``", "`unclosed",

  // Escapes, breaks and prose that looks like a block
  "a \\* b \\_ c \\[ d \\\\ e \\q f \\| g \\# h \\. i \\! j", "line one\\\nline two", "line one  \nline two", "soft\nwrap", "ends \\",
  "a\\\n- b", "a\\\n# h", "a\\\n> q", "a\\\n1. i", "\\# not", "\\- not", "\\> not", "1\\. not", "\\+ not", "#", "-", "+", ">x", "1.", "12) x",
  "a **\\\n** b",

  // Links
  "[a](https://example.com)", "[a](HTTPS://EXAMPLE.COM:443/a/../b)", "[a](https://example.com/a b)", "[a](https://bücher.example/ü?q=é#f)",
  "[a](relative/path)", "[a](/rooted)", "[a](//proto.example)", "[a](#frag)", "[a](?q=1)", "[a](mailto:A@Example.com)",
  "[a](javascript:alert(1))", "[a](data:text/html,x)", "[a]()", "[a](  https://e.com  )", "[a](http:foo)",
  "[a](https://user:pw@e.com/%7e|^`{}')", "[a](http://[::1]:80/x)", "[a](http://999.999.999.999/)", "[**bold** link](https://e.com)",
  "[nested [brackets]](https://e.com)", "[a](https://e.com/(paren))", "go to https://example.com/x, now.", "(http://e.com)", "xhttps://e.com",
  "HTTP://E.COM/Path", "https://", "https://e.com/a_b_c*d*", "*https://e.com*",

  // Photos
  "![photo](attachment:abc-123)", "Here is a ![photo](attachment:abc-123) inline.", "![remote](https://e.com/x.png)", "![](attachment:x)",
  "![a](attachment: spaced )", "![a](attachment:b c)", "**![in bold](attachment:q)**", "[![img link](attachment:q)](https://e.com)",
  "# ![h](attachment:h)", "!", "![", "!!",

  // Odd text
  "héllo — 日本語 _ünï_ 🎉 **🎉**", "日_本_語", "tab\there", "trailing spaces   \n\nnext", " leading space", "a\r\nb\r\rc",
  "para\n| not | table |", "<!-- sealbook:table h=1:2 -->", "<script>alert(1)</script>", "a &amp; b",
];
