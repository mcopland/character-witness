// Control sample
const normalVariable = "this is fine";
const numbers = [1, 2, 3];
function calculate(x, y) {
  return x + y;
}

// 1. Zero Width Space (u+200b)
zero_width_space = "admin​test";

// 2. Zero Width Joiner (u+200d)
zero_width_joiner = "alpha‍beta";

// 3. No-Break Space (u+00a0)
no_break_space = "hello world";

// 4. Narrow No-Break Space (u+202f)
narrow_no_break_space = "100 km";

// 5. Smart Quotes (u+2018, u+2019, u+201c, u+201d)
smart_single = "‘quoted’"; // u+2018 + u+2019
smart_double = "“double quoted”"; // u+201c + u+201d

// 6. Prime / Double Prime (u+2032, u+2033)
prime = "5′ 10″";

// 7. Dashes (u+2013, u+2014, u+2011)
en_dash = "1–10";
em_dash = "Wait—what?";
non_breaking_hyphen = "co‑founder";

// 8. Minus sign (u+2212)
negative = "−5";

// 9. Ellipsis (u+2026)
ellipsis = "Loading…";

// 10. Mathematical Symbols
math_expression = "5 × 3 ÷ 2 ± 1"; // u+00d7, u+00f7, u+00b1
comparison = "a ≠ b, a ≤ b, a ≥ b, a ≈ b"; // u+2260, u+2264, u+2265, u+2248
infinity = "∞"; // u+221e
root_sum = "√x + ∑i + ∆x"; // u+221a, u+2211, u+2206

// 11. Bullets & Squares
bullets = "• ◦ ▪ ▫"; // u+2022, u+25e6, u+25aa, u+25ab

// 12. Arrows
arrows = "→ ← ↑ ↓ ⇒ ⇄"; // u+2192, u+2190, u+2191, u+2193, u+21d2, u+21c4

// 13. Currency Symbols
currency = "€ £ ¥ ₹"; // u+20ac, u+00a3, u+00a5, u+20b9

// 14. Misc Symbols
legal = "© ® ™ § ¶"; // u+00a9, u+00ae, u+2122, u+00a7, u+00b6
units = "90° 10µm · value"; // u+00b0, u+00b5, u+00b7

// 15. Emoji
emoji = "🙂 👍 ✅ ❌ 🔹";

// 16. Cyrillic 'a' (u+0430)
а_variable = true;

// 17. Multiple issues in one line
multi_issue = "foo​bar baz…"; // u+200b, u+00a0, u+2026
