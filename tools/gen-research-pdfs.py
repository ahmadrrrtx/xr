#!/usr/bin/env python3
"""Generate the local research corpus for the UI-redesign research sweep.

Three self-contained educational notes on quantum error correction, written
as ordinary flowing text (reportlab Paragraph flowables) so the engine's PDF
text extraction sees clean, citable prose. Content is real and accurate; no
placeholder filler — the research run answers from these pages with [sN]
citations, so every claim here is one we are willing to stand behind.

Usage:  python3 tools/gen-research-pdfs.py [out_dir]   (default /tmp/xr-pdfs)
"""
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/xr-pdfs")

TITLE = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=16, spaceAfter=10, leading=20)
H = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=12, spaceBefore=12, spaceAfter=4, leading=15)
BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=10.5, leading=15, spaceAfter=6)


def build(filename: str, title: str, sections: list[tuple[str, list[str]]]) -> None:
    doc = SimpleDocTemplate(
        str(OUT / filename),
        pagesize=A4,
        leftMargin=22 * mm, rightMargin=22 * mm, topMargin=20 * mm, bottomMargin=20 * mm,
        title=title, author="XR research corpus",
    )
    story = [Paragraph(title, TITLE)]
    for heading, paras in sections:
        story.append(Paragraph(heading, H))
        for p in paras:
            story.append(Paragraph(p, BODY))
        story.append(Spacer(1, 4))
    doc.build(story)


BASICS = [
    ("What quantum error correction is", [
        "Quantum error correction (QEC) protects quantum information from noise by encoding the logical state of a small number of qubits into an entangled state of many physical qubits. Whereas classical error correction can simply copy a bit, the no-cloning theorem forbids copying an unknown quantum state, so redundancy in the quantum setting must be built through entanglement rather than duplication.",
        "The key insight is that one never measures the encoded data directly. Measuring a qubit in an unknown superposition would collapse it. Instead, an error-correcting code is defined by a set of stabilizer operators, multi-qubit measurements whose outcomes are guaranteed to be fixed and known while no error has occurred. A non-trivial stabilizer measurement outcome, called a syndrome, signals that something has changed without revealing anything about the logical state itself.",
        "The syndrome pattern tells a decoder which error most likely occurred, and a corresponding correction returns the system to the codespace. Because qubit noise is continuous, a further discretization result matters: arbitrary small errors decompose into Pauli errors (bit flips X, phase flips Z, and combined Y), so a code that corrects the Pauli basis corrects all small errors to leading order. This is why the syndrome picture, though built from discrete outcomes, suffices.",
    ]),
    ("The threshold theorem", [
        "The threshold theorem is the central result that makes scalable quantum computing plausible. It states that if the physical error rate per operation is below some constant threshold characteristic of the code and noise model, then arbitrarily long quantum computations can be performed with a logical error rate as small as desired, provided the code is enlarged and the gates are fault-tolerant. The overhead grows only polylogarithmically with the inverse of the target logical error rate.",
        "Early concatenated codes established thresholds around 10^-6, which was far beyond the fidelity of real devices. Topological codes, especially the surface code, raised the threshold to around 1 percent for realistic local noise, which brought fault tolerance within reach of superconducting hardware operating near or below that level.",
        "In practice the theorem translates into an engineering budget: every added layer of encoding multiplies the qubit count, so the practical target for a useful logical qubit is a logical error rate of roughly 10^-12 or better for long algorithms, achieved with several thousand physical qubits per logical qubit at near-term error rates.",
    ]),
    ("Stabilizer formalism in brief", [
        "A stabilizer code is specified by an abelian subgroup of the n-qubit Pauli group that does not contain minus the identity. Its simultaneous eigenspace with eigenvalue +1 is the codespace, and the dimension of that space gives the number of encoded logical qubits k, with n physical qubits total. The [[7,1,3]] Steane code and the [[5,1,3]] perfect code are the classic small examples; both encode one logical qubit and correct any single-qubit error, with code distance 3.",
        "Code distance d is the minimum weight of a logical operator, the smallest Pauli string that maps the codespace to itself non-trivially. A code corrects up to floor((d-1)/2) arbitrary single-position errors, so raising the distance is the primary knob for suppressing logical error rates, at the price of more physical qubits.",
    ]),
]

SURFACE = [
    ("Why the surface code dominates today", [
        "The surface code is a topological stabilizer code arranged on a 2D lattice of physical qubits, with alternating X-type and Z-type stabilizer measurement rounds. Its dominance in near-term hardware roadmaps comes from a combination of properties that fit real devices: it needs only nearest-neighbor interactions on a planar chip, it has one of the highest known thresholds of any 2D local code at roughly 1 percent, and its decoding problem is a classical computation that runs fast enough to keep up with the quantum hardware.",
        "Because the checks are local, a defect (a changed stabilizer over time) only spreads within a bounded region, and logical information is protected by being delocalized over the whole lattice. Errors appear as pairs of defects, and decoding is the problem of pairing observed defects to the most likely error chains, a minimum-weight perfect matching problem for the standard circuit-level noise model.",
        "Distance scales with lattice size: a distance-d rotated surface code uses roughly 2d^2 data qubits plus a comparable number of measure qubits, and the logical error rate falls off exponentially in d once physical error rates are under threshold. Hardware programs from Google, IBM, Quantinuum and academic labs all treat the surface code, or a close variant, as the reference point for fault-tolerant scaling.",
    ]),
    ("Experimental status", [
        "Google's Willow processor demonstrated below-threshold surface code operation, showing that scaling the code distance from 3 to 5 to 7 reduced the logical error rate by a factor of about 2.14 per distance step, the exponential suppression the theory predicts. The same experiment reported logical qubits with error rates better than the best physical qubit on the chip, a landmark crossing.",
        "Other platforms contribute complementary evidence. Neutral-atom arrays have run surface codes with mid-circuit measurement and feedforward, and transversal gate experiments on trapped ions and atoms show alternative routes to logical operations. Harvard and QuEra work demonstrated dozens of logical qubits operated under post-selected and dynamically reconfigurable error correction.",
        "Alongside the surface code family, practitioners use a small toolbox of related codes: heavy-hex and rotated variants adapted to hardware connectivity, the color code on specific lattices for its transversal Clifford gates, and bosonic codes such as the cat and GKP codes that protect information in oscillator modes and have shown break-even operation in superconducting cavities.",
    ]),
    ("Operations on surface codes", [
        "Measuring stabilizers requires repeated syndrome extraction cycles, since measurement itself is noisy and defects are identified by changes between rounds. A fault-tolerant logical operation set is built from lattice surgery, where two code patches are merged and split to implement multi-qubit Pauli measurements, and from magic state injection and distillation for the non-Clifford T gate, since the Eastin-Knill theorem forbids a universal gate set implemented transversally in any fixed code.",
        "The standard prescription is Clifford operations natively in the code plus T gates via magic states distilled in dedicated factory patches. Factories dominate the physical-qubit overhead estimates for early fault-tolerant machines, which is why so much current research targets cheaper T gates and cheaper codes.",
    ]),
]

OPEN = [
    ("Overhead and the path to usefulness", [
        "The most cited open problem is cost. At physical error rates near 10^-3, a single logical qubit at 10^-12 needs a few thousand physical qubits with the surface code, so a machine running cryptographically relevant Shor instances or deep chemistry workloads is quoted in the millions of physical qubits. Reducing that overhead is the central systems question of the field.",
        "Quantum low-density parity-check (qLDPC) codes are the leading candidate for the next factor-of-ten improvement. IBM's gross code and related constructions encode many logical qubits with constant or near-constant relative overhead, but they demand long-range couplers or clever scheduling to measure their checks on planar hardware, and their decoders are younger and less proven than surface code decoders. Basing a roadmap on qLDPC codes remains a bet on connectivity engineering.",
    ]),
    ("Decoding in real time", [
        "Decoding is a live constraint. The syndrome stream from a large surface code produces gigabits per second of measurement data, and the decoder must keep up so that corrections are applied within the coherence budget of the computation. Minimum-weight perfect matching is close to real-time capable, but achieving sustained logical clock rates with streaming decoders, correlated noise, leakage reset events and adaptive circuits (as in lattice surgery schedules) is unsolved engineering.",
        "Machine-learning decoders and union-find style algorithms trade accuracy against latency, and the field still lacks a settled benchmark suite that measures a decoder under realistic correlated noise rather than idealized circuit-level noise.",
    ]),
    ("Beyond the idealized noise model", [
        "Real devices violate the assumptions behind threshold estimates. Error rates drift with calibration and age, leakage moves qubits out of the computational subspace, crosstalk correlates nominally independent errors, and measurement bias breaks symmetry between X and Z. Codes and decoders that are robust to biased noise, such as XZZX surface codes, show real gains on paper, but a full treatment of time-dependent, spatially correlated noise is open.",
        "Cosmic-ray and radiation events in superconducting chips produce correlated error bursts across many qubits at once, forcing mitigation strategies like duplication of logical qubits and rapid re-identification of bad regions. None of these effects appears in the original threshold proofs.",
    ]),
    ("Logical operations and algorithms", [
        "Cheap non-Clifford operations remain a grand challenge: magic state distillation factories are the dominant overhead in most resource estimates, and alternatives such as transversal T through code switching or native hardware T gates are partial answers. Algorithmic resource estimates also assume long coherent surface code memory, while actual early machines will run noisy, partially error-corrected algorithms with pragmatic mixes of error mitigation and correction.",
        "Finally, the field needs a decisive demonstration that a logical qubit stack end to end, from calibration through decoding through logical operations, beats the best unencoded device on a useful task, and a credible account of how logical clock speeds of microseconds to milliseconds can support algorithms whose logical depth runs into the billions of operations.",
    ]),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    build("qec-basics.pdf", "Quantum Error Correction: Foundations", BASICS)
    build("surface-codes.pdf", "Surface Codes and Modern Code Practice", SURFACE)
    build("qec-open-questions.pdf", "Open Problems in Quantum Error Correction", OPEN)
    for f in sorted(OUT.glob("*.pdf")):
        print(f"{f}  {f.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
