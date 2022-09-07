+++
title = "Implementing snapshot fuzzing in QEMU"
date = 2022-09-09
+++

## Summary



## Snapshot fuzzing

Fuzz testing is a powerful tool used to find bugs in complex programs by running
them again randomized inputs. Coverage-guided fuzzing uses program control flow
information to optimize the inputs to reach as much code as possible when
running. This way, we increase the chances of finding a crash, which is
typically a bug in the code. Fuzzing has found many vulnerabilities in code in
the past and researchers constantly work to improve its efficacy.

The basic principle of fuzzing requires running the same code over and over
again. Some functions have no side effects and can be safely called repeatedly.
However, most code perform some side effects, and the state and environment need
to be properly reset after each invocation.

There are many ways to restore the state. AFL++, one of the most popular
fuzzers, uses a fork server. On each run of the program, the main process forks
a child to run the code to be fuzzed in. This way, restoring the original state
is as easy as killing the child and forking again. Another popular fuzzer,
libfuzzer, ignores this problem entirely and expects the programmer to restore
the state themselves. This presents a big challenge when dealing with complex
programs, especially those with multiple processes interacting with each other
at the same time. While AFL++'s fork server approach solves the state restore
problem for simpler programs, it cannot handle larger programs (such as
browsers) with IPC (inter-process communication). Additionally, fork servers are
slow, requiring a copy of the entire child on each fork, and thus each
iteration, of the fuzzer.

I aim to solve the problem of restoring complex state by using a technique
called snapshot fuzzing. Here, we run the code in a VM (QEMU). We maintain speed
despite running the program in a VM by leveraging virtualization technologies
such as KVM. Instead of using a fork server or manually restoring the state, we
take an initial "snapshot" of the entire state of the VM, which can be roughly
categorized into memory (RAM), CPU state (registers), and devices (drivers,
peripherals, etc.). Then, we run the program as normal. Once we are done
running, we can reset the state by restoring to the snapshot we took earlier.
Since this is a full snapshot of the VM, we can fuzz interesting programs, even
those that use complex IPC.

## QEMU patch

## Future work

## Snapshot harness

### Performance

## How to use

Note: this requires building QEMU from source (in order to use my custom patch).
The program under fuzz testing must also be instrumented with libfuzzer, so
clang is required.

### Linux VM

Any linux distro will work. The only requirement is that you can communicate
with the PCI device. I recommend the latest Ubuntu LTS version, specifically the
"cloud image", which works nicely with QEMU. If you have never used QEMU before,
[this][qemu-ubuntu-article] is a good guide to setting up Ubuntu and QEMU.

[qemu-ubuntu-article]: https://powersj.io/posts/ubuntu-qemu-cli/

### QEMU flags

The only QEMU flags strictly necessary for using the snapshot fuzzer is `-device
snapshot`. Make sure to add this after any networking or other PCI flags to make
finding the correct PCI device easier. I also recommend using `-enable-kvm` for
significant speed improvements.

### Locate PCI device

