+++
title = "Implementing snapshot fuzzing in QEMU"
date = 2022-09-09
+++

## Summary

- custom QEMU fork implementing snapshot/restores
    - [https://github.com/richyliu/qemu-fuzzing][github-harness]
- fuzzer harness for any program compatible with libfuzzer
    - [https://github.com/richyliu/neojetset-qemu/tree/dev-snapshot-shm][github-qemu]

## Background on snapshot fuzzing

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

## My contributions

I offer two main contributions as a result my work with the Google Summer of
Code: a [QEMU patch][github-qemu] for controlling snapshot/restores of the VM
and a [fuzzer "harness"][github-harness] to fuzz existing code built for
libfuzzer. I describe each in further detail below.

### QEMU patch

I patched QEMU to add two things. First, I added a PCI interface between the VM
guest and QEMU to allow for requests for saving and restoring a snapshot. I
reused existing functions `qemu_save_device_state` and `qemu_loadvm_state` save
and restore the VM's CPU and devices, and a copy-on-write mapping for memory
restores.

Second, I added an interface for sharing a shared memory region between the
guest and other program running on the host for IPC across the VM boundary. This
allows the libfuzzer process running on the host to communicate with the tested
code running on the guest.

### Fuzzer harness

The "harness" running on the host sends inputs to the guest and receives
coverage information. This is then fed into libfuzzer to generate new inputs,
optimizing for code coverage. In addition, the harness allows reuse of existing
fuzzing code targeting libfuzzer (anything with a `LLVMFuzzerTestOneInput`
function).

## How to use

Note: this requires building QEMU from source (in order to use my custom patch).
The program under fuzz testing must also be instrumented with libfuzzer, so
clang is required.

### Building QEMU

The snapshot device uses shared memory to communicate between the host and
guest. These paths are currently hardcoded in `hw/misc/snapshot.c` of my QEMU
fork. Make sure the `/dev/shm/` directory exists. If it does not, modify the
constants near the top of `hw/misc/snapshot.c`.

Clone the [dev-snapshot-shm branch][github-qemu] of my custom QEMU fork and
build it. Consult the [official guide][building-qemu] for steps. Note that only
x86_64 is currently supported for the fuzzer.

### Build snapshot harness

Clone my [snapshot harness][github-harness] code. Configure the paths to
libfuzzer and clang at the top of `fuzzer_bridge/Makefile`. Build the static
library and fuzzer controller by running:
```sh'
cd fuzzer_bridge
make server_fuzz libclient.a
```
This will produce an executable, `server_fuzz`, which you will run later, and a
static library, `libclient.a`.

### Linux VM

Any linux distro will work. The only requirement is that you can communicate
with the PCI device. I recommend the latest Ubuntu LTS version, specifically the
"cloud image", which works nicely with QEMU. If you have never used QEMU before,
[this][qemu-ubuntu-article] is a good guide to setting up Ubuntu and QEMU.

### QEMU flags

The only QEMU flags strictly necessary for using the snapshot fuzzer is `-device
snapshot`. Make sure to add this after any networking or other PCI flags to make
finding the correct PCI device easier. I also recommend using `-enable-kvm` for
significant speed improvements.

### Locate PCI device

Next, you need to find which PCI device corresponds to the snapshot device in
QEMU. The snapshot device has an ID of `1234:f987`. Run the following command to
search for the PCI device:
```sh
lspci | grep "1234:f987"
```

You should get an output similar to the following:
```
00:04.0 Unclassified device [00ff]: Device 1234:f987 (rev 10)
```
The first column is the device ID. Note that the `4` might be a different number
and varies based on the peripherals you have on your VM. Remember this string
(`00:04.0`).

### Build fuzz target

Build the fuzz target as you would normally for libfuzzer, using `clang` and
`-fsanitize=fuzzer-no-link` during compilation and linking to get coverage
instrumentation. Link the final object files against `libclient.a`, which
provides the entrypoint. A full example can be seen in `fuzzer_bridge/Makefile`,
which builds `test.c`, a toy program that crashes on certain inputs.

### Run fuzzer

To run the fuzzer, start the QEMU VM. Run the executable that you built from the
previous step (after linking with libclient.a). Then, open a separate terminal
and run `./server_fuzz` in the `fuzzer_bridge` directory, which you built
earlier. You should now the `server_fuzz` program outputting the fuzzing status.

## Future work

There is still a lot of work that can be done to improve the speed and efficacy
of the fuzzer. First of all, not all coverage information generated by
libfuzzer's instrumentation is passed from the VM to the host. Currently, only
the PC counters related to branching is passed. Most notably, comparison results
(which are instrumented) is not passed. This includes the
`__sanitizer_cov_trace_cmp*` and `__sanitizer_cov_trace_cmp*` family of functions.

Another area that is work in progress is the memory restore process. Currently
the copy-on-write method is slow (despite not copying the whole RAM on each
iteration) due to the expense of page faults after the pages are discarded and
remmaped COW on each iteration of the fuzzer. To combat this, we can use
existing dirty-page tracking tools in KVM to restore the pages manually, thereby
significantly reducing page faults.

The last flaw is a small one, and related to the user friendliness of the
application. Currently, crashes are not handled and cause the `server_fuzz`
application on the host to wait perpetually. Future work could be done to detect
and report crashes and the crashed input.


[building-qemu]:       https://wiki.qemu.org/Hosts/Linux#Building_QEMU_for_Linux
[github-harness]:      https://github.com/richyliu/qemu-fuzzing
[github-qemu]:         https://github.com/richyliu/neojetset-qemu/tree/dev-snapshot-shm
[qemu-ubuntu-article]: https://powersj.io/posts/ubuntu-qemu-cli/
