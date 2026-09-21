"use strict";
/*
 Copyright (C) 2012-2015 Grant Galitz
 
 Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 
 The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 
 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
function GameBoyAdvanceSerial(IOCore) {
    this.IOCore = IOCore;
}
GameBoyAdvanceSerial.prototype.initialize = function () {
    this.SIODATA_A = 0xFFFF;
    this.SIODATA_B = 0xFFFF;
    this.SIODATA_C = 0xFFFF;
    this.SIODATA_D = 0xFFFF;
    this.SIOShiftClockExternal = 0;
    this.SIOShiftClockDivider = 0x40;
    this.SIOCNT0_DATA = 0x0C;
    this.SIOTransferStarted = false;
    this.SIOMULT_PLAYER_NUMBER = 0;
    // Physical position on the emulated cable. When MULTI mode is selected,
    // hardware exposes this ID immediately in SIOCNT bits 4-5.
    this.linkPlayerNumber = 0;
    this.linkPlayerIdValid = false;
    this.SIOCOMMERROR = false;
    this.SIOBaudRate = 0;
    this.SIOCNT_UART_CTS = false;
    this.SIOCNT_UART_MISC = 0;
    this.SIOCNT_UART_FIFO = 0;
    this.SIOCNT_IRQ = 0;
    this.SIOCNT_MODE = 0;
    this.SIOCNT_UART_RECV_ENABLE = false;
    this.SIOCNT_UART_SEND_ENABLE = false;
    this.SIOCNT_UART_PARITY_ENABLE = false;
    this.SIOCNT_UART_FIFO_ENABLE = false;
    this.SIODATA8 = 0xFFFF;
    this.RCNTMode = 0;
    this.RCNTIRQ = false;
    this.RCNTDataBits = 0;
    this.RCNTDataBitFlow = 0;
    this.JOYBUS_IRQ = 0;
    this.JOYBUS_CNTL_FLAGS = 0;
    this.JOYBUS_RECV0 = 0xFF;
    this.JOYBUS_RECV1 = 0xFF;
    this.JOYBUS_RECV2 = 0xFF;
    this.JOYBUS_RECV3 = 0xFF;
    this.JOYBUS_SEND0 = 0xFF;
    this.JOYBUS_SEND1 = 0xFF;
    this.JOYBUS_SEND2 = 0xFF;
    this.JOYBUS_SEND3 = 0xFF;
    this.JOYBUS_STAT = 0;
    this.shiftClocks = 0;
    this.serialBitsShifted = 0;
    this.linkCable = null;
    this.linkTransferSequence = 0;
    this.linkExternalTransferPending = false;
    this.linkExternalTransferWords = [0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF];
    this.linkExternalTransferPlayer = 0;
    this.linkExternalTransferError = false;
    this.linkExternalTransferClocks = 0;
    this.linkExternalTransferCycles = 0;
    this.linkExternalTransferHold = false;
    this.linkExternalTransferTimingDone = false;
    this.linkExternalProgressive = false;
    this.linkExternalStage0Cycle = 0;
    this.linkExternalStage1Cycle = 0;
    this.linkExternalStage0Done = false;
    this.linkExternalStage1Done = false;
    this.linkSIOCNTWriteObserver = null;
    this.linkSIOMULTIReadObserver = null;
    this.linkRCNTWriteObserver = null;
}
GameBoyAdvanceSerial.prototype.SIOMultiplayerBaudRate = [
      9600,
     38400,
     57600,
    115200
];
// Measured/derived Multi-Player transfer durations used by mGBA, indexed by
// baud (0-3) and number of connected secondary GBAs (0-3).
GameBoyAdvanceSerial.prototype.LinkMultiplayerTransferCycles = [
    [31976, 63427, 94884, 125829],
    [ 8378, 16241, 24104,  31457],
    [ 5750, 10998, 16241,  20972],
    [ 3140,  5755,  8376,  10486]
];

GameBoyAdvanceSerial.prototype.attachLinkCable = function (adapter) {
    this.linkCable = adapter || null;
    this.linkPlayerIdValid = false;
    this.SIOMULT_PLAYER_NUMBER = 0;
    if (this.linkCable && typeof this.linkCable.playerNumber === "number") {
        this.linkPlayerNumber = this.linkCable.playerNumber & 0x3;
    }
};
GameBoyAdvanceSerial.prototype.detachLinkCable = function () {
    this.linkCable = null;
    this.linkPlayerNumber = 0;
    this.linkPlayerIdValid = false;
    this.SIOMULT_PLAYER_NUMBER = 0;
    this.SIOTransferStarted = false;
    this.SIOCOMMERROR = false;
    this.linkExternalTransferPending = false;
    this.linkExternalTransferClocks = 0;
    this.linkExternalTransferCycles = 0;
    this.linkExternalTransferHold = false;
    this.linkExternalTransferTimingDone = false;
    if (this.IOCore && typeof this.IOCore.endLinkCableWait == "function") {
        this.IOCore.endLinkCableWait(false);
    }
};
GameBoyAdvanceSerial.prototype.linkCableConnected = function () {
    if (!this.linkCable) {
        return false;
    }
    if (typeof this.linkCable.isConnected == "function") {
        try {
            return !!this.linkCable.isConnected();
        }
        catch (error) {
            return false;
        }
    }
    return true;
};
GameBoyAdvanceSerial.prototype.linkCableReady = function () {
    if (!this.linkCableConnected()) {
        return false;
    }
    if (this.linkCable && typeof this.linkCable.isReady == "function") {
        try {
            return !!this.linkCable.isReady();
        }
        catch (error) {
            return false;
        }
    }
    return true;
};
GameBoyAdvanceSerial.prototype.setLinkPlayerNumber = function (playerNumber) {
    this.linkPlayerNumber = (playerNumber | 0) & 0x3;
    if (this.linkPlayerIdValid) {
        this.SIOMULT_PLAYER_NUMBER = this.linkPlayerNumber;
    }
};
GameBoyAdvanceSerial.prototype.getLinkPlayerNumber = function () {
    if (this.linkCableConnected()) {
        return this.linkPlayerNumber & 0x3;
    }
    return this.SIOMULT_PLAYER_NUMBER & 0x3;
};
GameBoyAdvanceSerial.prototype.getLinkSendData = function () {
    return this.SIODATA8 & 0xFFFF;
};
GameBoyAdvanceSerial.prototype.getNormalLinkData = function () {
    if ((this.SIOCNT_MODE | 0) == 0) {
        return this.SIODATA8 & 0xFF;
    }
    // Normal 32-bit mode aliases SIODATA32_L/H onto SIOMULTI0/1.
    return (((this.SIODATA_B & 0xFFFF) << 16) | (this.SIODATA_A & 0xFFFF)) >>> 0;
};
GameBoyAdvanceSerial.prototype.completeExternalNormalTransfer = function (receivedData) {
    receivedData = Number(receivedData) >>> 0;
    if ((this.SIOCNT_MODE | 0) == 0) {
        this.SIODATA8 = receivedData & 0xFF;
    }
    else if ((this.SIOCNT_MODE | 0) == 1) {
        this.SIODATA_A = receivedData & 0xFFFF;
        this.SIODATA_B = (receivedData >>> 16) & 0xFFFF;
    }
    else {
        return false;
    }

    this.SIOTransferStarted = false;
    this.serialBitsShifted = 0;
    this.shiftClocks = 0;
    if ((this.SIOCNT_IRQ | 0) != 0 && this.IOCore && this.IOCore.irq) {
        this.IOCore.irq.requestIRQ(0x80);
    }
    if (
        this.linkCable &&
        typeof this.linkCable.onNormalTransferComplete == "function"
    ) {
        try {
            this.linkCable.onNormalTransferComplete({
                mode: this.SIOCNT_MODE | 0,
                data: receivedData >>> 0
            });
        }
        catch (error) {}
    }
    return true;
};
GameBoyAdvanceSerial.prototype.notifyLinkSendDataChange = function () {
    if (
        this.linkCable &&
        typeof this.linkCable.onSendDataChange == "function"
    ) {
        try {
            this.linkCable.onSendDataChange(this.getLinkSendData() | 0);
        }
        catch (error) {}
    }
};
GameBoyAdvanceSerial.prototype.beginExternalMultiplayerTransfer = function (playerNumber) {
    this.setLinkPlayerNumber(playerNumber | 0);
    this.SIOTransferStarted = true;
    this.SIOCOMMERROR = false;
    // GBATEK documents SIOMULTI0..3 as reset to FFFF on transfer
    // start on every participating GBA.
    this.SIODATA_A = 0xFFFF;
    this.SIODATA_B = 0xFFFF;
    this.SIODATA_C = 0xFFFF;
    this.SIODATA_D = 0xFFFF;
    this.serialBitsShifted = 0;
    this.shiftClocks = 0;
    this.linkExternalTransferPending = false;
    this.linkExternalTransferClocks = 0;
    this.linkExternalTransferCycles = 0;
    if (this.IOCore && typeof this.IOCore.beginLinkCableWait == "function") {
        this.IOCore.beginLinkCableWait();
    }
    return this.getLinkSendData() | 0;
};
GameBoyAdvanceSerial.prototype.completeExternalMultiplayerTransfer = function (words, playerNumber, commError, connectedCount, holdCompletion, transferBaud, elapsedCycles, transferCycleOverride, progressiveStages) {
    words = words || [];
    connectedCount = Math.max(0, Math.min(3, connectedCount | 0)) | 0;
    this.setLinkPlayerNumber(playerNumber | 0);
    this.linkExternalTransferWords = [
        (words[0] === undefined ? 0xFFFF : words[0]) & 0xFFFF,
        (words[1] === undefined ? 0xFFFF : words[1]) & 0xFFFF,
        (words[2] === undefined ? 0xFFFF : words[2]) & 0xFFFF,
        (words[3] === undefined ? 0xFFFF : words[3]) & 0xFFFF
    ];
    this.linkExternalTransferPlayer = this.linkPlayerNumber & 0x3;
    this.linkExternalTransferError = !!commError;
    var effectiveBaud = (typeof transferBaud == "number")
        ? (transferBaud | 0) & 0x3
        : this.SIOBaudRate & 0x3;
    var defaultTransferCycles =
        this.LinkMultiplayerTransferCycles[effectiveBaud][connectedCount] | 0;
    this.linkExternalTransferCycles =
        (typeof transferCycleOverride == "number" && (transferCycleOverride | 0) > 0)
            ? (transferCycleOverride | 0)
            : defaultTransferCycles;
    // A lockstep secondary can receive the START event slightly after the
    // parent's timestamp. Count that elapsed virtual time immediately so both
    // cores still complete at the same absolute finish cycle.
    this.linkExternalTransferClocks = Math.max(
        0,
        Math.min(
            this.linkExternalTransferCycles | 0,
            (typeof elapsedCycles == "number" ? elapsedCycles | 0 : 0)
        )
    ) | 0;
    this.linkExternalTransferHold = !!holdCompletion;
    this.linkExternalTransferTimingDone = false;
    this.linkExternalProgressive = !!progressiveStages;
    this.linkExternalStage0Cycle = progressiveStages ? Math.max(0, progressiveStages[0] | 0) : 0;
    this.linkExternalStage1Cycle = progressiveStages ? Math.max(0, progressiveStages[1] | 0) : 0;
    this.linkExternalStage0Done = false;
    this.linkExternalStage1Done = false;

    // If a secondary receives START slightly late, expose any bus stages that
    // would already have happened at the shared parent timestamp.
    if (this.linkExternalProgressive) {
        if ((this.linkExternalTransferClocks | 0) >= (this.linkExternalStage0Cycle | 0)) {
            this.SIODATA_A = this.linkExternalTransferWords[0] & 0xFFFF;
            this.linkExternalStage0Done = true;
        }
        if ((this.linkExternalTransferClocks | 0) >= (this.linkExternalStage1Cycle | 0)) {
            this.SIODATA_B = this.linkExternalTransferWords[1] & 0xFFFF;
            this.linkExternalStage1Done = true;
        }
    }
    this.linkExternalTransferPending = true;

    // Network rendezvous is complete. Resume virtual time, but keep SIO BUSY
    // until the emulated hardware transfer duration has elapsed.
    if (this.IOCore && typeof this.IOCore.endLinkCableWait == "function") {
        this.IOCore.endLinkCableWait(!commError);
    }
};
GameBoyAdvanceSerial.prototype.finishExternalMultiplayerTransfer = function () {
    var words = this.linkExternalTransferWords || [0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF];
    this.linkPlayerIdValid = true;
    this.SIOMULT_PLAYER_NUMBER = this.linkExternalTransferPlayer & 0x3;
    this.SIODATA_A = words[0] & 0xFFFF;
    this.SIODATA_B = words[1] & 0xFFFF;
    this.SIODATA_C = words[2] & 0xFFFF;
    this.SIODATA_D = words[3] & 0xFFFF;
    this.SIOTransferStarted = false;
    this.SIOCOMMERROR = !!this.linkExternalTransferError;
    this.serialBitsShifted = 0;
    this.shiftClocks = 0;
    this.linkExternalTransferPending = false;
    this.linkExternalTransferClocks = 0;
    this.linkExternalTransferCycles = 0;
    this.linkExternalTransferHold = false;
    this.linkExternalTransferTimingDone = false;
    this.linkExternalProgressive = false;
    this.linkExternalStage0Done = false;
    this.linkExternalStage1Done = false;
    if ((this.SIOCNT_IRQ | 0) != 0 && this.IOCore && this.IOCore.irq) {
        this.IOCore.irq.requestIRQ(0x80);
    }
    if (
        this.linkCable &&
        typeof this.linkCable.onHardwareTransferComplete == "function"
    ) {
        try {
            this.linkCable.onHardwareTransferComplete({
                words: words.slice(0),
                playerNumber: this.SIOMULT_PLAYER_NUMBER & 0x3,
                error: !!this.SIOCOMMERROR
            });
        }
        catch (error) {}
    }
};
GameBoyAdvanceSerial.prototype.releaseExternalMultiplayerTransfer = function (commError) {
    if (!this.linkExternalTransferPending) {
        return false;
    }
    if (commError) {
        this.linkExternalTransferError = true;
    }
    this.linkExternalTransferHold = false;
    if (this.linkExternalTransferTimingDone) {
        this.finishExternalMultiplayerTransfer();
    }
    return true;
};
GameBoyAdvanceSerial.prototype.nextLinkEventTime = function () {
    if (
        this.SIOTransferStarted &&
        this.linkCableConnected() &&
        this.linkExternalTransferPending &&
        !this.linkExternalTransferTimingDone
    ) {
        var remaining =
            ((this.linkExternalTransferCycles | 0) -
            (this.linkExternalTransferClocks | 0)) | 0;
        // Avoid returning zero indefinitely if the serial clocks are caught
        // precisely at the boundary before addClocks() commits the event.
        return Math.max(remaining | 0, 1) | 0;
    }
    return 0x7FFFFFFF;
};
GameBoyAdvanceSerial.prototype.addClocks = function (clocks) {
    clocks = clocks | 0;
    if ((this.RCNTMode | 0) < 2) {
        switch (this.SIOCNT_MODE | 0) {
            case 0:
            case 1:
                // A connected adapter drives Normal-mode serial transfers.
                // Preserve the historical disconnected fallback only when no
                // cable owns the bus.
                if (
                    this.SIOTransferStarted &&
                    !this.linkCableConnected() &&
                    (this.SIOShiftClockExternal | 0) == 0
                ) {
                    this.shiftClocks = ((this.shiftClocks | 0) + (clocks | 0)) | 0;
                    while ((this.shiftClocks | 0) >= (this.SIOShiftClockDivider | 0)) {
                        this.shiftClocks = ((this.shiftClocks | 0) - (this.SIOShiftClockDivider | 0)) | 0;
                        this.clockSerial();
                    }
                }
                break;
            case 2:
                if (
                    this.SIOTransferStarted &&
                    this.linkCableConnected() &&
                    this.linkExternalTransferPending
                ) {
                    this.linkExternalTransferClocks =
                        ((this.linkExternalTransferClocks | 0) + (clocks | 0)) | 0;
                    if (this.linkExternalProgressive) {
                        if (
                            !this.linkExternalStage0Done &&
                            (this.linkExternalTransferClocks | 0) >= (this.linkExternalStage0Cycle | 0)
                        ) {
                            this.SIODATA_A = this.linkExternalTransferWords[0] & 0xFFFF;
                            this.linkExternalStage0Done = true;
                        }
                        if (
                            !this.linkExternalStage1Done &&
                            (this.linkExternalTransferClocks | 0) >= (this.linkExternalStage1Cycle | 0)
                        ) {
                            this.SIODATA_B = this.linkExternalTransferWords[1] & 0xFFFF;
                            this.linkExternalStage1Done = true;
                        }
                    }
                    if (
                        (this.linkExternalTransferClocks | 0) >=
                        (this.linkExternalTransferCycles | 0)
                    ) {
                        this.linkExternalTransferTimingDone = true;
                        if (!this.linkExternalTransferHold) {
                            this.finishExternalMultiplayerTransfer();
                        }
                    }
                }
                else if (this.SIOTransferStarted && (this.getLinkPlayerNumber() | 0) == 0) {
                    this.shiftClocks = ((this.shiftClocks | 0) + (clocks | 0)) | 0;
                    while ((this.shiftClocks | 0) >= (this.SIOShiftClockDivider | 0)) {
                        this.shiftClocks = ((this.shiftClocks | 0) - (this.SIOShiftClockDivider | 0)) | 0;
                        this.clockMultiplayer();
                    }
                }
                break;
            case 3:
                if (this.SIOCNT_UART_SEND_ENABLE && !this.SIOCNT_UART_CTS) {
                    this.shiftClocks = ((this.shiftClocks | 0) + (clocks | 0)) | 0;
                    while ((this.shiftClocks | 0) >= (this.SIOShiftClockDivider | 0)) {
                        this.shiftClocks = ((this.shiftClocks | 0) - (this.SIOShiftClockDivider | 0)) | 0;
                        this.clockUART();
                    }
                }
        }
    }
}
GameBoyAdvanceSerial.prototype.clockSerial = function () {
    //Emulate as if no slaves connected:
    this.serialBitsShifted = ((this.serialBitsShifted | 0) + 1) | 0;
    if ((this.SIOCNT_MODE | 0) == 0) {
        //8-bit
        this.SIODATA8 = ((this.SIODATA8 << 1) | 1) & 0xFFFF;
        if ((this.serialBitsShifted | 0) == 8) {
            this.SIOTransferStarted = false;
            this.serialBitsShifted = 0;
            if ((this.SIOCNT_IRQ | 0) != 0) {
                //this.IOCore.irq.requestIRQ(0x80);
            }
        }
    }
    else {
        //32-bit
        this.SIODATA_D = ((this.SIODATA_D << 1) & 0xFE) | (this.SIODATA_C >> 7);
        this.SIODATA_C = ((this.SIODATA_C << 1) & 0xFE) | (this.SIODATA_B >> 7);
        this.SIODATA_B = ((this.SIODATA_B << 1) & 0xFE) | (this.SIODATA_A >> 7);
        this.SIODATA_A = ((this.SIODATA_A << 1) & 0xFE) | 1;
        if ((this.serialBitsShifted | 0) == 32) {
            this.SIOTransferStarted = false;
            this.serialBitsShifted = 0;
            if ((this.SIOCNT_IRQ | 0) != 0) {
                //this.IOCore.irq.requestIRQ(0x80);
            }
        }
    }
}
GameBoyAdvanceSerial.prototype.clockMultiplayer = function () {
    // When an external Link adapter is active, completion is driven by the
    // remote bus. Keep the hardware busy until the adapter supplies A/B/C/D.
    if (this.linkCableConnected()) {
        return;
    }
    // Fallback: emulate as if no slaves were connected.
    this.SIODATA_A = this.SIODATA8 | 0;
    this.SIODATA_B = 0xFFFF;
    this.SIODATA_C = 0xFFFF;
    this.SIODATA_D = 0xFFFF;
    this.SIOTransferStarted = false;
    this.SIOCOMMERROR = true;
    if ((this.SIOCNT_IRQ | 0) != 0 && this.IOCore && this.IOCore.irq) {
        this.IOCore.irq.requestIRQ(0x80);
    }
}
GameBoyAdvanceSerial.prototype.clockUART = function () {
    this.serialBitsShifted = ((this.serialBitsShifted | 0) + 1) | 0;
    if (this.SIOCNT_UART_FIFO_ENABLE) {
        if ((this.serialBitsShifted | 0) == 8) {
            this.serialBitsShifted = 0;
            this.SIOCNT_UART_FIFO = Math.max(((this.SIOCNT_UART_FIFO | 0) - 1) | 0, 0) | 0;
            if ((this.SIOCNT_UART_FIFO | 0) == 0 && (this.SIOCNT_IRQ | 0) != 0) {
                //this.IOCore.irq.requestIRQ(0x80);
            }
        }
    }
    else {
        if ((this.serialBitsShifted | 0) == 8) {
            this.serialBitsShifted = 0;
            if ((this.SIOCNT_IRQ | 0) != 0) {
                //this.IOCore.irq.requestIRQ(0x80);
            }
        }
    }
}
GameBoyAdvanceSerial.prototype.writeSIODATA_A0 = function (data) {
    data = data | 0;
    this.SIODATA_A = (this.SIODATA_A & 0xFF00) | data;
}
GameBoyAdvanceSerial.prototype.readSIODATA_A0 = function () {
    if (typeof this.linkSIOMULTIReadObserver == "function") {
        try {
            this.linkSIOMULTIReadObserver(0, this.SIODATA_A & 0xFFFF);
        }
        catch (error) {}
    }
    return this.SIODATA_A & 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_A1 = function (data) {
    data = data | 0;
    this.SIODATA_A = (this.SIODATA_A & 0xFF) | (data << 8);
}
GameBoyAdvanceSerial.prototype.readSIODATA_A1 = function () {
    return this.SIODATA_A >> 8;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_B0 = function (data) {
    data = data | 0;
    this.SIODATA_B = (this.SIODATA_B & 0xFF00) | data;
}
GameBoyAdvanceSerial.prototype.readSIODATA_B0 = function () {
    if (typeof this.linkSIOMULTIReadObserver == "function") {
        try {
            this.linkSIOMULTIReadObserver(1, this.SIODATA_B & 0xFFFF);
        }
        catch (error) {}
    }
    return this.SIODATA_B & 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_B1 = function (data) {
    data = data | 0;
    this.SIODATA_B = (this.SIODATA_B & 0xFF) | (data << 8);
}
GameBoyAdvanceSerial.prototype.readSIODATA_B1 = function () {
    return this.SIODATA_B >> 8;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_C0 = function (data) {
    data = data | 0;
    this.SIODATA_C = (this.SIODATA_C & 0xFF00) | data;
}
GameBoyAdvanceSerial.prototype.readSIODATA_C0 = function () {
    if (typeof this.linkSIOMULTIReadObserver == "function") {
        try {
            this.linkSIOMULTIReadObserver(2, this.SIODATA_C & 0xFFFF);
        }
        catch (error) {}
    }
    return this.SIODATA_C & 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_C1 = function (data) {
    data = data | 0;
    this.SIODATA_C = (this.SIODATA_C & 0xFF) | (data << 8);
}
GameBoyAdvanceSerial.prototype.readSIODATA_C1 = function () {
    return this.SIODATA_C >> 8;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_D0 = function (data) {
    data = data | 0;
    this.SIODATA_D = (this.SIODATA_D & 0xFF00) | data;
}
GameBoyAdvanceSerial.prototype.readSIODATA_D0 = function () {
    if (typeof this.linkSIOMULTIReadObserver == "function") {
        try {
            this.linkSIOMULTIReadObserver(3, this.SIODATA_D & 0xFFFF);
        }
        catch (error) {}
    }
    return this.SIODATA_D & 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_D1 = function (data) {
    data = data | 0;
    this.SIODATA_D = (this.SIODATA_D & 0xFF) | (data << 8);
}
GameBoyAdvanceSerial.prototype.readSIODATA_D1 = function () {
    return this.SIODATA_D >> 8;
}
GameBoyAdvanceSerial.prototype.writeSIOCNT0 = function (data) {
    if (typeof this.linkSIOCNTWriteObserver == "function") {
        try {
            this.linkSIOCNTWriteObserver({
                data: data & 0xFF,
                mode: this.SIOCNT_MODE | 0,
                playerNumber: this.getLinkPlayerNumber() | 0,
                busyBefore: !!this.SIOTransferStarted
            });
        }
        catch (error) {}
    }
    if ((this.RCNTMode | 0) < 0x2) {
        switch (this.SIOCNT_MODE | 0) {
            //8-Bit:
            case 0:
            //32-Bit:
            case 1:
                this.SIOShiftClockExternal = data & 0x1;
                this.SIOShiftClockDivider = ((data & 0x2) != 0) ? 0x8 : 0x40;
                this.SIOCNT0_DATA = data & 0xB;
                if ((data & 0x80) != 0) {
                    if (!this.SIOTransferStarted) {
                        this.SIOTransferStarted = true;
                        this.serialBitsShifted = 0;
                        this.shiftClocks = 0;

                        if (
                            this.linkCableConnected() &&
                            this.linkCable &&
                            typeof this.linkCable.startNormalTransfer == "function"
                        ) {
                            try {
                                this.linkTransferSequence = ((this.linkTransferSequence | 0) + 1) | 0;
                                this.linkCable.startNormalTransfer({
                                    sequence: this.linkTransferSequence | 0,
                                    mode: this.SIOCNT_MODE | 0,
                                    data: this.getNormalLinkData(),
                                    // GBA SIOCNT bit 0: 1 = internal clock/master,
                                    // 0 = external clock/slave.
                                    internalClock: (data & 0x1) != 0,
                                    fastClock: (data & 0x2) != 0
                                });
                            }
                            catch (error) {
                                if (this.linkCable && typeof this.linkCable.onLinkError == "function") {
                                    try { this.linkCable.onLinkError(error); } catch (ignored) {}
                                }
                            }
                        }
                    }
                }
                else {
                    this.SIOTransferStarted = false;
                }
                break;
            //Multiplayer:
            case 2:
                this.SIOBaudRate = data & 0x3;
                this.SIOShiftClockDivider = this.SIOMultiplayerBaudRate[this.SIOBaudRate | 0] | 0;
                if (!this.linkCableConnected()) {
                    this.SIOMULT_PLAYER_NUMBER = (data >> 4) & 0x3;
                    this.SIOCOMMERROR = ((data & 0x40) != 0);
                }

                var linkPlayerNumber = this.getLinkPlayerNumber() | 0;
                var linkChild = this.linkCableConnected() && linkPlayerNumber != 0;

                // In real MULTI mode bit 7 is read-only on secondary GBAs.
                // A child becomes busy only when the parent clocks a transfer.
                if (!linkChild) {
                    if ((data & 0x80) != 0) {
                        if (!this.SIOTransferStarted) {
                            this.SIOTransferStarted = true;
                            if ((linkPlayerNumber | 0) == 0) {
                                // mGBA clears the primary receive registers at START.
                                this.SIODATA_A = 0xFFFF;
                                this.SIODATA_B = 0xFFFF;
                                this.SIODATA_C = 0xFFFF;
                                this.SIODATA_D = 0xFFFF;
                            }
                            this.serialBitsShifted = 0;
                            this.shiftClocks = 0;

                            if (
                                (linkPlayerNumber | 0) == 0 &&
                                this.linkCableConnected() &&
                                this.linkCable &&
                                typeof this.linkCable.startMultiplayerTransfer == "function"
                            ) {
                                this.linkTransferSequence = ((this.linkTransferSequence | 0) + 1) | 0;
                                try {
                                    var linkStarted = this.linkCable.startMultiplayerTransfer({
                                        sequence: this.linkTransferSequence | 0,
                                        word: this.getLinkSendData() | 0,
                                        baud: this.SIOBaudRate | 0
                                    });
                                    if (linkStarted === false) {
                                        // Cable is present but the remote game is not yet in
                                        // multiplayer mode. Hardware remains connected; just
                                        // leave BUSY clear so the game can retry naturally.
                                        this.SIOTransferStarted = false;
                                        this.SIOCOMMERROR = false;
                                    }
                                    else {
                                        // A successfully accepted transfer starts with a clean
                                        // communication-error latch.
                                        this.SIOCOMMERROR = false;
                                    }

                                }
                                catch (error) {
                                    this.SIOCOMMERROR = true;
                                    if (this.linkCable && typeof this.linkCable.onLinkError == "function") {
                                        try { this.linkCable.onLinkError(error); } catch (ignored) {}
                                    }
                                }
                            }
                        }
                    }
                    else {
                        // In Multi-Player mode BUSY is hardware-owned once a
                        // transfer has started. Software writes with bit 7 clear
                        // must not abort an in-flight transfer; hardware clears
                        // BUSY only when the transfer actually completes.
                        if (!this.SIOTransferStarted) {
                            this.SIOTransferStarted = false;
                        }
                    }
                }
                else {
                    // Current mGBA behavior: a secondary GBA can latch bit 7 by
                    // writing SIOCNT even though it cannot generate the serial
                    // clock. The bit then remains set until the master transfer
                    // actually completes. Do not start a transfer here.
                    if ((data & 0x80) != 0 && !this.SIOTransferStarted) {
                        this.SIOTransferStarted = true;
                        this.serialBitsShifted = 0;
                        this.shiftClocks = 0;
                        this.SIOCOMMERROR = false;
                    }
                    // A write with bit 7 clear cannot cancel a latched/active
                    // secondary BUSY state; hardware clears it at completion.
                }
                break;
            //UART:
            case 3:
                this.SIOBaudRate = data & 0x3;
                this.SIOShiftClockDivider = this.SIOMultiplayerBaudRate[this.SIOBaudRate | 0] | 0;
                this.SIOCNT_UART_MISC = (data & 0xCF) >> 2;
                this.SIOCNT_UART_CTS = ((data & 0x4) != 0);
        }
    }
}
GameBoyAdvanceSerial.prototype.readSIOCNT0 = function () {
    if (this.RCNTMode < 0x2) {
        switch (this.SIOCNT_MODE) {
            //8-Bit:
            case 0:
            //32-Bit:
            case 1:
                // Do not invent multiplayer/cable status in Normal mode.
                // With an attached lockstep driver mGBA preserves the software
                // Normal-mode control bits and does not force bits 4-6 high.
                // SI is low here while the local cable driver owns the link;
                // disconnected fallback keeps the usual pulled-high SI.
                var normalSIState = this.linkCableConnected() ? 0 : 0x4;
                return ((this.SIOTransferStarted) ? 0x80 : 0) |
                    normalSIState |
                    this.SIOCNT0_DATA;
            //Multiplayer:
            case 2:
                // Multi-Player mode exposes two physical Link Cable state bits:
                // bit 2 = SI terminal (0 parent, 1 child)
                // bit 3 = SD terminal (1 when the connected GBAs are ready).
                // Some commercial games check these before enabling multiplayer.
                var linkConnected = this.linkCableConnected();
                var linkReady = this.linkCableReady();
                var visiblePlayerNumber = linkConnected
                    ? (this.getLinkPlayerNumber() | 0) & 0x3
                    : this.SIOMULT_PLAYER_NUMBER & 0x3;
                var terminalState = (linkConnected && visiblePlayerNumber != 0) ? 0x4 : 0;
                var readyState = linkReady ? 0x8 : 0;
                return ((this.SIOTransferStarted) ? 0x80 : 0) |
                    ((this.SIOCOMMERROR) ? 0x40 : 0) |
                    (visiblePlayerNumber << 4) |
                    readyState |
                    terminalState |
                    this.SIOBaudRate;
            //UART:
            case 3:
                return (this.SIOCNT_UART_MISC << 2) | ((this.SIOCNT_UART_FIFO == 4) ? 0x30 : 0x20) | this.SIOBaudRate;
        }
    }
    return 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIOCNT16 = function (data) {
    data = data | 0;
    // SIOCNT is one 16-bit hardware register. For halfword/word writes the
    // mode bits in the high byte take effect before interpreting the low-byte
    // mode-specific fields. This matches mGBA's atomic GBASIOWriteSIOCNT().
    this.writeSIOCNT1((data >> 8) & 0xFF);
    this.writeSIOCNT0(data & 0xFF);
};
GameBoyAdvanceSerial.prototype.writeSIOCNT1 = function (data) {
    this.SIOCNT_IRQ = data & 0x40;
    var oldMode = this.SIOCNT_MODE | 0;
    this.SIOCNT_MODE = (data >> 4) & 0x3;

    if (this.linkCableConnected() && (this.SIOCNT_MODE | 0) == 0x2) {
        this.linkPlayerIdValid = true;
        this.SIOMULT_PLAYER_NUMBER = this.linkPlayerNumber & 0x3;
    }

    if (
        (oldMode | 0) != (this.SIOCNT_MODE | 0) &&
        this.linkCable &&
        typeof this.linkCable.onSerialModeChange == "function"
    ) {
        try {
            this.linkCable.onSerialModeChange(this.SIOCNT_MODE | 0);
        }
        catch (error) {}
    }
    this.SIOCNT_UART_RECV_ENABLE = ((data & 0x8) != 0);
    this.SIOCNT_UART_SEND_ENABLE = ((data & 0x4) != 0);
    this.SIOCNT_UART_PARITY_ENABLE = ((data & 0x2) != 0);
    this.SIOCNT_UART_FIFO_ENABLE = ((data & 0x1) != 0);
}
GameBoyAdvanceSerial.prototype.readSIOCNT1 = function () {
    // SIOCNT bit 15 is unused/read-only 0 in Normal, Multi and UART modes.
    // Iodine historically forced it high, which is not hardware-accurate.
    return (this.SIOCNT_IRQ | (this.SIOCNT_MODE << 4) | ((this.SIOCNT_UART_RECV_ENABLE) ? 0x8 : 0) |
    ((this.SIOCNT_UART_SEND_ENABLE) ? 0x4 : 0) | ((this.SIOCNT_UART_PARITY_ENABLE) ? 0x2 : 0) | ((this.SIOCNT_UART_FIFO_ENABLE) ? 0x2 : 0));
}
GameBoyAdvanceSerial.prototype.writeSIODATA8_0 = function (data) {
    data = data | 0;
    this.SIODATA8 = (this.SIODATA8 & 0xFF00) | data;
    if ((this.RCNTMode | 0) < 0x2 && (this.SIOCNT_MODE | 0) == 3 && this.SIOCNT_UART_FIFO_ENABLE) {
        this.SIOCNT_UART_FIFO = Math.min(((this.SIOCNT_UART_FIFO | 0) + 1) | 0, 4) | 0;
    }
}
GameBoyAdvanceSerial.prototype.readSIODATA8_0 = function () {
    return this.SIODATA8 & 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIODATA8_1 = function (data) {
    data = data | 0;
    this.SIODATA8 = (this.SIODATA8 & 0xFF) | (data << 8);
    if ((this.SIOCNT_MODE | 0) == 0x2) {
        // A 16-bit SIOMLT_SEND write reaches low then high. Notify only after
        // the high byte so the Link bridge sees one complete prepared word.
        this.notifyLinkSendDataChange();
    }
}
GameBoyAdvanceSerial.prototype.readSIODATA8_1 = function () {
    return this.SIODATA8 >> 8;
}
GameBoyAdvanceSerial.prototype.writeRCNT0 = function (data) {
    if (typeof this.linkRCNTWriteObserver == "function") {
        try { this.linkRCNTWriteObserver(0, data & 0xFF); } catch (error) {}
    }
    if ((this.RCNTMode | 0) == 0x2) {
        //General Comm:
        var oldDataBits = this.RCNTDataBits | 0;
        this.RCNTDataBits = data & 0xF;    //Device manually controls SI/SO/SC/SD here.
        this.RCNTDataBitFlow = data >> 4;
        if (this.RCNTIRQ && ((oldDataBits ^ this.RCNTDataBits) & oldDataBits & 0x4) != 0) {
            //SI fell low, trigger IRQ:
            //this.IOCore.irq.requestIRQ(0x80);
        }
    }
}
GameBoyAdvanceSerial.prototype.readRCNT0 = function () {
    // RCNT bits 0-3 expose the live SC/SD/SI/SO pin states even while
    // Normal/Multiplayer mode is selected. Mario Bros. is known to poll SC.
    // Match mGBA's observable multiplayer wiring:
    //   host idle/busy  -> SC 1/0, SI 0
    //   child idle/busy -> SC 1/0, SI 1
    // SD/SO are not synthesized here; SIOCNT exposes ready/terminal state.
    if (
        (this.RCNTMode | 0) < 0x2 &&
        (this.SIOCNT_MODE | 0) == 0x2 &&
        this.linkCableConnected()
    ) {
        var busy = !!this.SIOTransferStarted;
        var playerNumber = this.getLinkPlayerNumber() | 0;
        var pins = 0;

        if (playerNumber == 0) {
            if (!busy) {
                pins |= 0x1; // Host SC high while idle, low while active.
            }
        }
        else {
            // Keep SC high on secondary GBAs throughout MULTI mode, matching
            // mGBA's lockstep driver. SI identifies this console as a child.
            pins |= 0x1;
            pins |= 0x4;
        }
        if (this.linkCableReady()) {
            // mGBA mirrors multiplayer READY onto RCNT SD as well.
            pins |= 0x2;
        }
        return (this.RCNTDataBitFlow << 4) | pins;
    }
    return (this.RCNTDataBitFlow << 4) | this.RCNTDataBits;
}
GameBoyAdvanceSerial.prototype.writeRCNT1 = function (data) {
    if (typeof this.linkRCNTWriteObserver == "function") {
        try { this.linkRCNTWriteObserver(1, data & 0xFF); } catch (error) {}
    }
    this.RCNTMode = data >> 6;
    this.RCNTIRQ = ((data & 0x1) != 0);
    if ((this.RCNTMode | 0) != 0x2) {
        //Force SI/SO/SC/SD to low as we're never "hooked" up:
        this.RCNTDataBits = 0;
        this.RCNTDataBitFlow = 0;
    }
}
GameBoyAdvanceSerial.prototype.readRCNT1 = function () {
    // RCNT high byte:
    // bit 0 = IRQ enable, bits 1-5 are reserved/read as 0,
    // bits 6-7 select the serial mode.
    return (this.RCNTMode << 6) | ((this.RCNTIRQ) ? 0x1 : 0);
}
GameBoyAdvanceSerial.prototype.writeJOYCNT = function (data) {
    this.JOYBUS_IRQ = (data << 25) >> 31;
    this.JOYBUS_CNTL_FLAGS &= ~(data & 0x7);
}
GameBoyAdvanceSerial.prototype.readJOYCNT = function () {
    return (this.JOYBUS_CNTL_FLAGS | 0x40) | (0xB8 & this.JOYBUS_IRQ);
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_RECV0 = function (data) {
    this.JOYBUS_RECV0 = data | 0;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_RECV0 = function () {
    this.JOYBUS_STAT = this.JOYBUS_STAT & 0xF7;
    return this.JOYBUS_RECV0 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_RECV1 = function (data) {
    this.JOYBUS_RECV1 = data | 0;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_RECV1 = function () {
    this.JOYBUS_STAT = this.JOYBUS_STAT & 0xF7;
    return this.JOYBUS_RECV1 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_RECV2 = function (data) {
    this.JOYBUS_RECV2 = data | 0;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_RECV2 = function () {
    this.JOYBUS_STAT = this.JOYBUS_STAT & 0xF7;
    return this.JOYBUS_RECV2 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_RECV3 = function (data) {
    this.JOYBUS_RECV3 = data | 0;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_RECV3 = function () {
    this.JOYBUS_STAT = this.JOYBUS_STAT & 0xF7;
    return this.JOYBUS_RECV3 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_SEND0 = function (data) {
    this.JOYBUS_SEND0 = data | 0;
    this.JOYBUS_STAT = this.JOYBUS_STAT | 0x2;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_SEND0 = function () {
    return this.JOYBUS_SEND0 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_SEND1 = function (data) {
    this.JOYBUS_SEND1 = data | 0;
    this.JOYBUS_STAT = this.JOYBUS_STAT | 0x2;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_SEND1 = function () {
    return this.JOYBUS_SEND1 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_SEND2 = function (data) {
    this.JOYBUS_SEND2 = data | 0;
    this.JOYBUS_STAT = this.JOYBUS_STAT | 0x2;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_SEND2 = function () {
    return this.JOYBUS_SEND2 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_SEND3 = function (data) {
    this.JOYBUS_SEND3 = data | 0;
    this.JOYBUS_STAT = this.JOYBUS_STAT | 0x2;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_SEND3 = function () {
    return this.JOYBUS_SEND3 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_STAT = function (data) {
    this.JOYBUS_STAT = data | 0;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_STAT = function () {
    return 0xC5 | this.JOYBUS_STAT;
}
/*GameBoyAdvanceSerial.prototype.nextIRQEventTime = function (clocks) {
    if ((this.SIOCNT_IRQ | 0) != 0 && (this.RCNTMode | 0) < 2) {
        switch (this.SIOCNT_MODE | 0) {
            case 0:
            case 1:
                if (this.SIOTransferStarted && (this.SIOShiftClockExternal | 0) == 0) {
                    return ((((this.SIOCNT_MODE == 1) ? 31 : 7) - this.serialBitsShifted) * this.SIOShiftClockDivider) + (this.SIOShiftClockDivider - this.shiftClocks);
                }
                else {
                    return 0x7FFFFFFF;
                }
            case 2:
                if (this.SIOTransferStarted && this.getLinkPlayerNumber() == 0) {
                    return this.SIOShiftClockDivider - this.shiftClocks;
                }
                else {
                    return 0x7FFFFFFF;
                }
            case 3:
                if (this.SIOCNT_UART_SEND_ENABLE && !this.SIOCNT_UART_CTS) {
                    return (Math.max(((this.SIOCNT_UART_FIFO_ENABLE) ? (this.SIOCNT_UART_FIFO * 8) : 8) - 1, 0) * this.SIOShiftClockDivider) + (this.SIOShiftClockDivider - this.shiftClocks);
                }
                else {
                    return 0x7FFFFFFF;
                }
        }
    }
    else {
        return 0x7FFFFFFF;
    }
}*/