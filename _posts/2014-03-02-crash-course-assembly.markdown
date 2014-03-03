---
layout: post
title: "Crash Course in Assembly"
date: 2014-03-02 21:04:00
comments: true
---

This post is based off of my experience from CIS 450, taught at K-State. We are learning assembly in the format used by the [GNU Assembler](http://en.wikipedia.org/wiki/GNU_Assembler) on both x86 and x86-64 architectures. My understanding is very limited at this point, so expect the post to evolve as the semester goes on.

The assignment where I started really learning assembly involved this C program:

```cpp
#include <stdio.h>

int bar (int z)
{
  return (z + 15);
}

int foo (int a1, int a2, int a3, int a4, int a5, int a6, int a7)
{
  // force x to be stored in memory
  volatile int x;
  x = a1 * a2 + a3 * a4 + a5 * a6 + a7;
  return bar(x);
}

int main()
{
  int y;

  y = foo(1, 2, 3, 4, 5, 6, 7);
  printf("y = %d\n", y);
  return 0;
}
```

The following is the relevant assembly generated using <kbd>gcc -S -O1 input.c</kbd>

```asm
bar:
.LFB24:
  movl   4(%esp), %eax
  addl   $15, %eax
  ret
foo:
  subl   $20, %esp
  movl   28(%esp), %edx
  imull  24(%esp), %edx
  movl   36(%esp), %eax
  imull  32(%esp), %eax
  addl   %edx, %eax
  movl   44(%esp), %edx
  imull  40(%esp), %edx
  addl   %edx, %eax
  addl   48(%esp), %eax
  movl   %eax, 16(%esp)
  movl   16(%esp), %eax
  movl   %eax, (%esp)
  call   bar
  addl   $20, %esp
  ret
main:
  pushl  %ebp
  movl   %esp, %ebp
  andl   $-16, %esp
  subl   $32, %esp
  movl   $7, 24(%esp)
  movl   $6, 20(%esp)
  movl   $5, 16(%esp)
  movl   $4, 12(%esp)
  movl   $3, 8(%esp)
  movl   $2, 4(%esp)
  movl   $1, (%esp)
  call   foo
  movl   %eax, 8(%esp)
  movl   $.LC0, 4(%esp)
  movl   $1, (%esp)
  call   __printf_chk
  movl   $0, %eax
  leave
  ret
```

### Walkthrough

I'll break this up into bite-sized pieces, as well as track the stack and registers as they change.

```asm
pushl  %ebp
movl   %esp, %ebp
```

This preserves the old base stack pointer `ebp`, then changes the basic stack pointer to the current stack pointer `esp`.

```asm
andl   $-16, %esp
```

Basically this tries to align the stack pointer so that the address is a multiple of 16. This alignment can optimize certain x86 instructions, but isn't terrible important here.

```asm
subl   $32, %esp
```

Decrements the stack pointer by 32 bytes. This gives us room for eight 4-byte (32-bit) integers.

```asm
movl   $7, 24(%esp)
movl   $6, 20(%esp)
movl   $5, 16(%esp)
movl   $4, 12(%esp)
movl   $3, 8(%esp)
movl   $2, 4(%esp)
movl   $1, (%esp)
call   foo
```

Prepares some arguments (`a1` through `a7`) and calls the procedure `foo`.

Assuming that our stack pointer started at address `fe4`, our stack looks something like this:

| Address | Value |
|---------|-------|
| fe4     | *previous base stack pointer* |
| fe0     |       |
| fdc     |       |
| fd8     | 7     |
| fd4     | 6     |
| fd0     | 5     |
| fcc     | 4     |
| fc8     | 3     |
| fc4     | 2     |
| fc0     | 1     |
| fbc     | *return address for foo* |

| Register | Value |
|----------|-------|
| ebp      | fe0   |
| esp      | fbc   |

Now the program starts execution at the top of the `foo` procedure.

```asm
subl $20, %esp
```

Decrements the stack pointer by 20 bytes. This gives us room for five 4-byte (32-bit) integers.

```asm
movl   28(%esp), %edx
imull  24(%esp), %edx
movl   36(%esp), %eax
imull  32(%esp), %eax
addl   %edx, %eax
movl   44(%esp), %edx
imull  40(%esp), %edx
addl   %edx, $eax
addl   48(%esp), %eax
```

These instructions encompass everything that happens in this line of C

```cpp
x = a1 * a2 + a3 * a4 + a5 * a6 + a7;
```

Note that we start at `24(%esp)`, which is at address `fc0`. The 24-byte offset is because of the fact that we pushed the 4-byte return address on the stack, as well as 20 bytes for the local variable stack. For some reason, the compiler decided we needed 20 bytes, even though we actually only use 4 bytes.

At this point, the stack is still the same, but the registers look like this:

| Register | Value |
|----------|-------|
| ebp      | fe0   |
| esp      | fa8   |
| eax      | 66    |
| edx      | 30    |

The value in `eax` holds the answer of the calculations. The value in `edx` is now garbage, it was used in intermediary calculations.

```asm
movl   %eax, 16(%esp)
movl   16(%esp), %eax
```

Copies the value of `eax` into `16(%esp)`. I'm not sure why this happens at all. The rest of the program never reads from this address.

```asm
movl   %eax, (%esp)
call   bar
```

I'm also not sure why the compiler decided to use the stack to pass the sole argument into `bar` instead of using `eax`. Regardless, the stack and registers look something like this:

| Address | Value |
|---------|-------|
| fe4     | *previous base stack pointer* |
| fe0     |       |
| fdc     |       |
| fd8     | 7     |
| fd4     | 6     |
| fd0     | 5     |
| fcc     | 4     |
| fc8     | 3     |
| fc4     | 2     |
| fc0     | 1     |
| fbc     | *return address for foo* |
| fb8     | 66    |
| fb4     |       |
| fb0     |       |
| fac     | 66    |
| fa8     | *return address for bar* |
| fa4     |       |

| Register | Value |
|----------|-------|
| ebp      | fe0   |
| esp      | fa4   |
| eax      | 66    |

Here we copy the value in `eax` to the address specified by the stack pointer `esp`, then call the `bar` procedure.  Just like when `foo` is called from `main`, the return address is stored in `esp` and `esp` is decremented.

```asm
movl   4(%esp), %eax
addl   $15, %eax
ret
```

Pretty straighforward, copy the value off of the stack into `eax` and add 15 to it. Return to `foo` afterwards.

```asm
addl   $20, %esp
```

At this point, `foo` no longer needs the space is previously allocated on the stack, restore the stack pointer to its original address.

Now we're back in `main`, with the final result in hand (specifically in `eax`). Now we're going to print it to stdout.

```asm
movl   %eax, 8(%esp)
movl   $.LC0, 4(%esp)
movl   $1, (%esp)
call   __printf_chk
```

Prepares the arguments being passed to `printf` and then calls it.

```asm
movl $0, %eax
```

Sets the return value for `main` to zero.

```asm
leave
ret
```

Restores the stack pointer and base stack pointer and exits the `main` procedure.

### Side-effects

Out of all the things to analyze in this program, the hardest part for me was the side-effects of different instructions. While a lot of assembly references are great at describing the arguments of instructions and the effects on the instructions, they weren't very good at describing side-effects.

For example, `pushl SOURCE` roughly translates to this assembly.

```asm
subl   $4, %esp
movl   SOURCE, %esp
```

The `popl DEST` instruction is similar, but in reverse.

```asm
movl   %esp, DEST
addl   $4, %esp
```

Armed with these two basic building blocks, we can break down other instructions.

The `call` procedure is straightforward. First, the return address is pushed onto the stack. Next, the program jumps to the address of the procedure being called. Once the subprocedure is finished, it calls `ret`, which pops the return address and then jumps to that address.

The `leave` procedure is a bit more interesting, it looks something like this assembly code.

```asm
movl   %ebp, %esp
popl   %ebp
```

This effectively deallocates all of the space on the stack that we reserved. After that, it restores the old base stack pointer.

### What's Next

I plan to cover the assembly compiled for the x86-64 architecture. It is much more simple than the x86 version, due to the fact that more registers are available on x86-64. This means that the number of operations performed on the stack are less.

If any glaring errors are present in this post, feel free to submit an issue or pull request on this site's  [GitHub repository](https://github.com/ianunruh/ianunruh-jekyll/issues).

### Resources

- [x86 Disassembly/The Stack](http://en.wikibooks.org/wiki/X86_Disassembly/The_Stack)
- [Guide to x86 Assembly](http://www.cs.virginia.edu/~evans/cs216/guides/x86.html)
