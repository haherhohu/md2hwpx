import * as assert from "assert";
import { convertLatexToHwpScript } from "../math/latexToHwpEqn";

suite("LaTeX to HWP Equation Script Suite", () => {
    test("converts nested fractions recursively with balanced braces", () => {
        const result = convertLatexToHwpScript(String.raw`\frac{\frac{a}{b}}{\frac{c}{d}}`);
        assert.strictEqual(result, "{{{{a} over {b}}} over {{{c} over {d}}}}");
    });

    test("converts square roots and nth roots containing fractions", () => {
        assert.strictEqual(convertLatexToHwpScript(String.raw`\sqrt{\frac{x}{y}}`), "sqrt {{{x} over {y}}}");
        assert.strictEqual(convertLatexToHwpScript(String.raw`\sqrt[3]{\frac{x^2}{y+1}}`), "root {3} of {{{x ^{2}} over {y+1}}}");
    });

    test("converts sum and integral limits with superscripts/subscripts", () => {
        const sumRes = convertLatexToHwpScript(String.raw`\sum_{k=1}^{N} x_k`);
        assert.strictEqual(sumRes, "sum _{k=1} ^{N} x _{k}");

        const intRes = convertLatexToHwpScript(String.raw`\int_{0}^{\infty} e^{-x} \, dx`);
        assert.strictEqual(intRes, "int _{0} ^{inf} e ^{-x} ` dx");
    });

    test("converts matrix, pmatrix, bmatrix, and cases environments", () => {
        const pmat = convertLatexToHwpScript(String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`);
        assert.strictEqual(pmat, "left ( matrix {a & b # c & d} right )");

        const bmat = convertLatexToHwpScript(String.raw`\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}`);
        assert.strictEqual(bmat, "left [ matrix {1 & 0 # 0 & 1} right ]");

        const casesRes = convertLatexToHwpScript(String.raw`\begin{cases} x, & x \ge 0 \\ -x, & x < 0 \end{cases}`);
        assert.strictEqual(casesRes, "cases {x, & x >= 0 # -x, & x < 0}");
    });

    test("converts left/right delimiters and Greek symbols", () => {
        const res = convertLatexToHwpScript(String.raw`\left\{ \Delta, \theta, \tau_{\text{mod}}, \pm 110^\circ \right\}`);
        assert.strictEqual(res, 'left lbrace DELTA, theta, tau _{rm "mod"}, +- 110 ^{deg} right rbrace');
    });

    test("converts all 5 real-world block equations from ai_v2 sample cleanly without raw LaTeX leaks", () => {
        const eqs = [
            String.raw`S_t = \{ V_{\text{visited}}, \; O_{\text{sequence}}, \; P_{\text{tendency}}, \; I_{\text{hidden}}, \; G_{\text{role}} \}`,
            String.raw`P_{ij} = \frac{n(e_i \to e_j)}{\sum_{k=1}^{N} n(e_i \to e_k)}, \quad H(e_i) = -\sum_{j=1}^{N} P_{ij} \log_2 P_{ij}`,
            String.raw`P(X_{mj} = 1 \mid \theta_m, a_j, b_j) = \frac{1}{1 + \exp\left[-a_j (\theta_m - b_j)\right]}`,
            String.raw`\text{WOA} = \frac{| \text{Final Decision}_{\text{human}} - \text{Initial Estimate}_{\text{human}} |}{| \text{Prediction}_{\text{AI}} - \text{Initial Estimate}_{\text{human}} |}`,
            String.raw`S_{\text{total}} = 0.5 \times \underbrace{\left( 100 - \alpha \cdot | \hat{Y}_{\text{pred}} - Y_{\text{truth}} | \right)}_{S_{\text{accuracy}} \text{ (기상 수치 예측 정확도)}} + 0.5 \times \underbrace{\left( R_{\text{saved}} - C_{\text{false\_alarm}} \right)}_{S_{\text{decision}} \text{ (방재 의사결정 순효용)}}`,
        ];

        for (const eq of eqs) {
            const converted = convertLatexToHwpScript(eq);
            assert.ok(converted.length > 0);
            assert.ok(!/\\(?:frac|sqrt|sum|underbrace|left|right|text|alpha|theta|Delta|quad|to|mid|hat)/.test(converted), `Unexpected raw command in: ${converted}`);
        }

        const b5 = convertLatexToHwpScript(eqs[4]);
        assert.ok(b5.includes('rm " (기상 수치 예측 정확도)"'));
        assert.ok(b5.includes('rm "false_alarm"'));
        assert.ok(b5.includes("hat {Y}"));
    });
});
