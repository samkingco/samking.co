---
title: Sick of assumptions
slug: sick-of-assumptions
excerpt: LLMs are trained on neurotypical conversation patterns. When you say exactly what you mean, the model tries to read between lines that don't exist.
date: 2026-03-31
---

There's an old saying that assumptions make an ass out of u and me. I've been having a hard time with this lately, mostly because I spend a significant chunk of my working day talking to an LLM that won't stop making them.

I'm autistic so I say what I mean. There's no subtext, no hidden intent, no implied second request lurking behind the first. When I say "put the fix on a new branch", I mean put the fix on a new branch! I don't mean push the code. I don't mean open a PR. I don't mean do anything else at all. Just the thing I said.

But LLMs don't work like that.

You'd think a machine that processes literal text would be the ideal collaborator for someone who communicates literally. A system that parses instructions as tokens, operates on logic, exists in a world of explicit inputs and outputs. It should be perfect for the way my brain works. It's not.

I use Claude Code daily. I've written instructions, skills, agents, and memories that all explicitly tell the model to be literal, to not infer, to ask instead of assume. I've tried every trick in the book. It still goes off and does things I didn't ask for. The instructions get lost or aren't given enough weight. When the model falls back on its training, it falls back on a neurotypical model of conversation.

Things that happen regularly:

- I say "remove this copy" and it changes something else in the UI alongside it. If I'm not careful reviewing the output, the extra change goes uncaught.
- I say "put the fix on a new branch, I'll make a PR tomorrow" and it pushes the code, bypassing my own rules to do so.
- I ask it to make one specific change and it refactors the surrounding code for good measure.
- It adds three fallback handlers for code paths that will never fall back.
- I'm exploring an idea and it sprints off implementing before I've finished thinking.

Every time, the model has parsed my literal instruction and inferred some hidden meaning behind it. Some additional intent I must have had but didn't say. Except I did say everything I meant. There is no hidden meaning. It's got the point now where I have a macro on my keyboard for "did I say to do that? no, so undo that please".

I'd say 9 out of 10 times the model's "helpfulness" isn't helpful. And maybe 3 to 5 of those times it's actively harmful, burning tokens going down a path I explicitly didn't want. Sometimes the overreach catches something I missed, and I appreciate that. But the ratio is really bad.

It's not just overreach either. Sometimes the model goes the other way and just makes things up. I've lost count of the times I've had to say "actually read the code" because it's assumed something works a certain way without checking. In one Swift project it told me there were no tests. The root directory had a folder called SesameTests sitting right there. It had just listed the directory. It would rather give me a confident wrong answer than slow down and look.

I don't lie to the model, so why does it lie to me?

## Why it's like this

LLMs are shaped by reinforcement learning from human feedback. Real people rate the model's responses during training, and the responses that get rewarded become the default behaviour. "Helpful" as encoded by this process means anticipating needs the user didn't state. Reading between the lines. Inferring intent beyond the literal words. That's a neurotypical communication pattern, baked into the model at the deepest level.

I don't know the demographics of the people rating these models. It would be reductive to say they're all neurotypical. But the aggregate signal almost certainly skews that way, just by population numbers. The feedback that shapes models over time such as chat interactions, thumbs up and thumbs down, usage patterns etc. that all indexes toward the majority too. The result is a model optimised for a communication style that isn't _mine_.

There's actual research on this. Anthropic's [own sycophancy paper](https://arxiv.org/abs/2310.13548) found that RLHF preference judgments favour agreeable, socially smooth responses over truthful ones. OpenAI's [GPT-4o sycophancy incident](https://openai.com/index/sycophancy-in-gpt-4o/) in April 2025 proved the mechanism. They added user thumbs-up/down as a reward signal and the model got measurably worse. A [2024 study on neurodivergent LLM users](https://arxiv.org/html/2410.06336v1) found that neurotypical bias accounted for around 17-20% of the challenges autistic and ADHD users reported. People were sharing "aspie-friendly" prompt templates just to get the model to behave. And a [2025 paper](https://arxiv.org/html/2601.17946v1) introduced the concept of "automated masking", LLMs functioning as a normative filter that places the burden of adaptation on the neurodivergent user. One participant put it better than I can: "It wasn't me interacting with people; it was literally just computer algorithms interacting with people through me".

The Claude Code system prompt was recently leaked. In it, the instructions literally say "don't add features, refactor code, or make improvements beyond what was asked" and in the same breath tell the model "you're a collaborator, not just an executor — users benefit from your judgment, not just your compliance". The model has to reconcile contradictory instructions, and training wins.

## Same pattern, different machine

This is the same pattern autistic people navigate every day with humans. People assume you meant something you didn't. People "help" in ways you didn't ask for. People read tone and subtext that isn't there and act on their interpretation instead of your words. I thought a machine would be different. It processes text. It should take me at my word. But it's been trained out of literalness by the same social patterns that make human communication exhausting in the first place. The training pipeline has the same bias as the society it was trained on.

I don't have a solution. I don't know if the answer is more neurodivergent representation in training data. I don't know if it's a "literal mode" toggle. I don't know if it's possible to untangle the helpfulness training from the core capabilities. What I do know is what I want. I want a coding agent that takes me at my word. That treats my instructions as complete. That asks when something is ambiguous instead of assuming.

I'm not speaking for all autistic people. I'm speaking for me. But I suspect I'm not the only one burning tokens undoing changes I didn't ask for, writing increasingly desperate instructions that get ignored because the training signal is louder than the prompt.
