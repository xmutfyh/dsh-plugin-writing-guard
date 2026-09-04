# Writing Guard v2.0 - Research Basis

This note records the public writing guidance and open-source work used to design the v2.0 Argument Economy policy. The implementation and prompt wording in Writing Guard are original unless otherwise stated in `THIRD_PARTY.md`.

## Editorial principles

### Nature Methods - *So you're writing a paper* (2017)

Source: https://www.nature.com/articles/nmeth.4532

Design implications:
- Make each word perform useful work.
- Avoid gratuitous information that distracts from the argument.
- Readers bring intelligence to the reading process; repeated explanation is not automatically helpful.
- Prefer direct, simple language.

Writing Guard mapping:
- `Every sentence must earn its place.`
- `Do not close every semantic loop.`
- `CUT -> PRUNE -> RECAST -> SPLIT.`

### Tack et al. - *How to shorten scientific manuscripts* (2024)

Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC11182700/

Design implications:
- Avoid repeating information across Methods, Results, and Discussion.
- Trust readers to understand and remember a point that has been stated clearly once.
- Sentence-final clarification is often unnecessary when the preceding sentence is already clear.
- Concision must not break the scientific storyline or make the manuscript harder to understand.

Writing Guard mapping:
- Paraphrastic repetition and semantic-closure cues are deletion candidates.
- Style-only revision defaults to the same length or shorter.
- Concision never outranks scientific completeness or reproducibility.

### ICMJE Recommendations (updated January 2026)

Sources:
- https://www.icmje.org/recommendations/
- https://www.icmje.org/recommendations/browse/manuscript-preparation/preparing-for-submission.html
- https://www.icmje.org/recommendations/browse/artificial-intelligence/ai-use-by-authors.html

Design implications:
- Methods must remain sufficiently detailed for reproducibility.
- Results should emphasize the important observations rather than repeat every table/figure datum.
- Discussion should state real limitations and possible explanations but should not repeat detailed material from other sections.
- Conclusions must remain supported by the data.
- Humans remain responsible for accuracy and integrity when AI assists manuscript preparation.

Writing Guard mapping:
- Argument economy does **not** mean deleting necessary method detail, limitations, uncertainty, or non-obvious interpretation.
- Scholarship/Epistemic Lock outranks style reduction.
- Defensive wording is separated from legitimate scientific boundaries.

### Readable scientific prose / concise scientific writing

Sources:
- https://pmc.ncbi.nlm.nih.gov/articles/PMC1559667/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC11717450/

Design implications:
- Empty evaluations such as saying a finding is "interesting" or "important" add little unless the reason is made concrete.
- Unnecessary disclaimers, adjectives, and rhetorical padding obstruct the scientific message.
- Clarity and concise argumentation matter more than ornamental "scientific-sounding" prose.

Writing Guard mapping:
- `content-free-evaluation-en/zh`
- Defensive-purpose test
- Argument-economy prompt policy

## Open-source defensive-writing taxonomy references

See `THIRD_PARTY.md` for licenses and adaptation notes.

- Kiterlin/anti-defensive-writing (MIT): https://github.com/Kiterlin/anti-defensive-writing
- Worigin0314/academic-defensive-writing-auditor (MIT): https://github.com/Worigin0314/academic-defensive-writing-auditor
- matsuikentaro1/humanizer_academic (MIT): https://github.com/matsuikentaro1/humanizer_academic

Common failure modes that informed v2.0:
- reviewer-facing prebuttals;
- repeated non-claim disclaimers;
- caveat stacking;
- defenses of omitted experiments;
- excuses for imperfect results;
- legalistic reassurance;
- paraphrastic restatement;
- automatic paragraph-closing summaries;
- content-free evaluations of importance.

## v2.0 design boundary

Writing Guard intentionally does **not** treat all caution, all limitations, or all explanation as bad style.

Keep text when it is needed for:
- reproducibility;
- a non-obvious statistical interpretation;
- a real limitation or alternative explanation;
- causal/evidential calibration;
- scope or population boundaries;
- definitions needed by the intended readership.

Cut or tighten text when its only function is to:
- pre-empt a possible reviewer objection;
- reassure the reader that the authors considered a risk;
- narrate why the authors are mentioning a fact;
- restate a claim that is already explicit;
- close a paragraph with an automatic summary or importance claim;
- make style-only revisions longer without adding supported scientific information.

The core rule is therefore not "write less." It is: **spend prose only where it changes the reader's scientifically necessary understanding.**
