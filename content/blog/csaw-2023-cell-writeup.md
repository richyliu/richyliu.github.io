+++
title = "CSAW 2023 Finals Writeup: Cell"
date = 2023-11-19
+++

This is a writeup for Cell, a reverse engineering challenge from the CSAW 2023 finals. We are given a file named `cell.pkg`, around half a megabyte in size. Running `file` on it doesn't reveal much. `strings` isn't that helpful either. I tried searching up the first four bytes (`\x7fPKG`), which looked like some sort of magic bytes. The first couple of results on Google are all related to the PS3, so it's reasonable to assume that this is a PS3 game. The PS3 runs a Cell processor, which has a 64-bit PPC core and several coprocessors.

I downloaded [RPCS3](https://rpcs3.net/download), a PS3 emulator and debugger. I was able to load the file into the emulator and run it. When I ran it, a screen popped up with controller button icons arranged in the center and a timer in the top left. The text `Hmm... I'm trying to poll these inputs right....` suggests that this is supposed to be a controller input test. As the timer counts up, starting from `-48` and counting in increments of `16`, it the program abruptly stops at a count of `0`.

![img](screenshot1.png)
*Figure 1: game interface*

The challenge asked for the state of the registers after fixing the program, so I decided to extract the binary and look for what possibly could be wrong with it. On my computer, the RPCS3 loaded the game into the folder `~/Library/Application Support/rpcs3/dev_hdd0/game/CELL_00-0/USRDIR`. From there, I took the `EBOOT.BIN` file and extracted the ELF using RPCS3's "Decrypt PS3 Binaries" feature (under `Utilities`).

From there, I can load the binary into Ghidra and analyze it statically. But before that, I ran it with the debugger first. To do that, I had to tell RPCS3 to use an interpreter (right click the game and select `Change Custom Configuration`, select `Interpreter (static)` under the CPU tab). I used the handy call stack window in the debugger to figure out where the main function was (`00010bf0`). From there, I figured out the main loop that ran every 2 seconds which updated the timer count, among other things.

![img](screenshot2.png)
*Figure 2: timer increments and delays at end of main loop*

I also noticed that `r2` stores a base pointer that doesn't change in the main function. This pointer `0x1054b0` is the base of a string table. I noticed a string `Nice job, you did it ... check my regs :)` in the binary. Tracing this reveals an offset of `-0x7c20` from `r2`, which is loaded once in the main function. This indicated where in the program I needed to reach. There was a counter variable that matched the timer in the upper left hand corner of the screen. The "Nice job" message only printed once the timer got to 128, so I just let the program run until then.

![img](screenshot3.png)
*Figure 3: condition that causes program to exit early*

However, the program would exit when the timer count became nonnegative and the buttons pressed did not match some predetermined patterns. I simply patched out this `if` statement and exit condition. I used RPCS3's built-in patch functionality. I figured out the patch format using their [online documentation](https://wiki.rpcs3.net/index.php?title=Help:Game_Patches) and trial and error. To properly format the patch, I had to find the PPU hash, which I got from the log as the program booted up.

Here is the patch:

    Version: 1.2
    
    PPU-1c892d3d92a43cd0652fee9b9a4ecf319826943c:
      "mypatch":
        Games:
          "Cell":
            CELL: [ 01.00 ]
        Author: "a"
        Notes: "a"
        Patch Version: 2.0
        Patch:
          - [ be16, 0x0001224c, 0x4800 ] # to 0x000125f0 from 0x0001224c, skips fail portion

The `be16` tells RPCS3 that this is a 16-bit big-endian patch. The `0x0001224c` is the address and the `0x4800` is the value to patch with. All that this patch accomplishes is to convert a conditional branch into an unconditional branches, which skips the entire `if` statement.

![img](screenshot4.png)
*Figure 4: overwriting with unconditional branch*

Finally, I reached the "end" of the program where it put itself into an infinite loop. I fed the register values at this point into the flag oracle. Unfortunately, the `r27` register was wrong. From running it multiple times, I noticed that this register stored a bitmask of the buttons that were pressed. This likely was incorrect because I had patched out the `if` statement checking the buttons instead of actually figuring out what they were. Fortunately, my teammate Kevin (kmh) noticed that the four register values I had gotten right so far all had only one of the 8 bytes set:

    r3: 000000000000000a
    r5: 000000000000002b
    r9: 0100000000000000
    r10: 0000000000000001

He wrote a program to brute force all 256 possibilities for each of the 8 bytes, which yielded the correct result for r27, `0000000000000400`.

Although I definitely skipped much of the reverse engineering difficulties intended for this challenge (brute forcing the one register that varied), I still enjoyed reverse engineering a rare architecture. The PS3 debugging tooling was much better than I anticipated as well.


