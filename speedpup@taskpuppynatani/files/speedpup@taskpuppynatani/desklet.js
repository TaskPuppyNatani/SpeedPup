/*
 * SpeedPup
 * Copyright (C) 2026 TaskPuppyNatani
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Cairo = imports.cairo;
const ByteArray = imports.byteArray;

const REFRESH_SECONDS = 1;
const GRAPH_HISTORY_SECONDS = 60;
const GRAPH_WIDTH = 440;
const GRAPH_HEIGHT = 90;

class SpeedPupDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);

        this.speedTestServer = "91";

        this.settings = new Settings.DeskletSettings(
            this,
            metadata.uuid,
            deskletId
        );

        this.settings.bind(
            "speed-test-server",
            "speedTestServer"
        );

        this._removed = false;
        this._timerId = 0;
        this._speedTestProcess = null;

        this._lastRxBytes = null;
        this._lastTxBytes = null;
        this._lastSampleTime = null;

        this._downloadHistory = [];
        this._uploadHistory = [];

        this._networkFile = Gio.file_new_for_path("/proc/net/dev");

        this._buildUi();
        this._readNetworkStats();

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_SECONDS,
            () => {
                this._readNetworkStats();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _buildUi() {
        this._container = new St.BoxLayout({
            vertical: true,
            style_class: "speedpup-container"
        });

        this._title = new St.Label({
            text: "🐾 SpeedPup by TaskPuppyKreations 🐾",
            style_class: "speedpup-title"
        });

        this._liveSection = new St.Label({
            text: "Live Network Traffic",
            style_class: "speedpup-section-label"
        });

        this._downloadLabel = new St.Label({
            text: "↓ Download: measuring...",
            style_class: "speedpup-speed"
        });

        this._uploadLabel = new St.Label({
            text: "↑ Upload: measuring...",
            style_class: "speedpup-speed"
        });

        this._graphLegend = new St.Label({
            text: "↓ Download     ↑ Upload     • Last 60 seconds",
            style_class: "speedpup-graph-legend"
        });

        this._networkGraph = new St.DrawingArea({
            style_class: "speedpup-network-graph"
        });

        this._networkGraph.width = GRAPH_WIDTH;
        this._networkGraph.height = GRAPH_HEIGHT;

        this._graphRepaintSignal = this._networkGraph.connect(
            "repaint",
            area => this._drawNetworkGraph(area)
        );

        this._testSection = new St.Label({
            text: "Internet Speed Test",
            style_class: "speedpup-section-label speedpup-test-section"
        });

        this._testDownloadLabel = new St.Label({
            text: "↓ Download: --",
            style_class: "speedpup-result"
        });

        this._testUploadLabel = new St.Label({
            text: "↑ Upload: --",
            style_class: "speedpup-result"
        });

        this._pingLabel = new St.Label({
            text: "Ping: --",
            style_class: "speedpup-result"
        });

        this._testResultsBox = new St.BoxLayout({
            vertical: false,
            style_class: "speedpup-test-results"
        });

        this._testNumbersBox = new St.BoxLayout({
            vertical: true,
            style_class: "speedpup-test-numbers",
            x_expand: true
        });

        this._serverBox = new St.BoxLayout({
            vertical: true,
            style_class: "speedpup-server-box"
        });

        this._serverHeading = new St.Label({
            text: "Test Server",
            style_class: "speedpup-server-heading"
        });

        this._serverLabel = new St.Label({
            text: "--",
            style_class: "speedpup-server"
        });

        this._testNumbersBox.add_child(this._testDownloadLabel);
        this._testNumbersBox.add_child(this._testUploadLabel);
        this._testNumbersBox.add_child(this._pingLabel);

        this._serverBox.add_child(this._serverHeading);
        this._serverBox.add_child(this._serverLabel);

        this._testResultsBox.add_child(this._testNumbersBox);
        this._testResultsBox.add_child(this._serverBox);

        this._speedTestButtonLabel = new St.Label({
            text: "▶ Run Speed Test"
        });

        this._speedTestButton = new St.Button({
            style_class: "speedpup-button",
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        this._speedTestButton.set_child(this._speedTestButtonLabel);

        this._buttonSignalId = this._speedTestButton.connect(
            "clicked",
            () => this._runSpeedTest()
        );

        this._container.add_child(this._title);
        this._container.add_child(this._liveSection);
        this._container.add_child(this._downloadLabel);
        this._container.add_child(this._uploadLabel);
        this._container.add_child(this._graphLegend);
        this._container.add_child(this._networkGraph);

        this._container.add_child(this._testSection);
        this._container.add_child(this._testResultsBox);
        this._container.add_child(this._speedTestButton);

        this.setContent(this._container);
    }

    _readNetworkStats() {
        this._networkFile.load_contents_async(null, (file, result) => {
            if (this._removed) {
                return;
            }

            try {
                const [success, contents] = file.load_contents_finish(result);

                if (!success) {
                    this._showNetworkError("Unable to read network statistics");
                    return;
                }

                const text = ByteArray.toString(contents);
                const totals = this._parseNetworkStats(text);

                if (totals === null) {
                    this._showNetworkError("No network interfaces found");
                    return;
                }

                this._updateSpeeds(totals.rx, totals.tx);
            } catch (error) {
                global.logError(`SpeedPup network read failed: ${error}`);
                this._showNetworkError("Network monitor error");
            }
        });
    }

    _parseNetworkStats(text) {
        const lines = text.split("\n");

        let totalRx = 0;
        let totalTx = 0;
        let foundInterface = false;

        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim();

            if (!line) {
                continue;
            }

            const parts = line.split(/[:\s]+/);

            if (parts.length < 10) {
                continue;
            }

            const interfaceName = parts[0];

            if (interfaceName === "lo") {
                continue;
            }

            const rxBytes = Number(parts[1]);
            const txBytes = Number(parts[9]);

            if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) {
                continue;
            }

            totalRx += rxBytes;
            totalTx += txBytes;
            foundInterface = true;
        }

        if (!foundInterface) {
            return null;
        }

        return {
            rx: totalRx,
            tx: totalTx
        };
    }

    _updateSpeeds(rxBytes, txBytes) {
        const now = GLib.get_monotonic_time();

        if (
            this._lastRxBytes === null ||
            this._lastTxBytes === null ||
            this._lastSampleTime === null
        ) {
            this._lastRxBytes = rxBytes;
            this._lastTxBytes = txBytes;
            this._lastSampleTime = now;
            return;
        }

        const elapsedSeconds =
            (now - this._lastSampleTime) / 1000000;

        if (elapsedSeconds <= 0) {
            return;
        }

        let rxDelta = rxBytes - this._lastRxBytes;
        let txDelta = txBytes - this._lastTxBytes;

        if (rxDelta < 0) {
            rxDelta = 0;
        }

        if (txDelta < 0) {
            txDelta = 0;
        }

        const downloadBytesPerSecond =
            rxDelta / elapsedSeconds;

        const uploadBytesPerSecond =
            txDelta / elapsedSeconds;

        this._downloadLabel.set_text(
            `↓ Download: ${this._formatRate(downloadBytesPerSecond)}`
        );

        this._uploadLabel.set_text(
            `↑ Upload: ${this._formatRate(uploadBytesPerSecond)}`
        );

        this._downloadHistory.push(downloadBytesPerSecond);
        this._uploadHistory.push(uploadBytesPerSecond);

        if (this._downloadHistory.length > GRAPH_HISTORY_SECONDS) {
            this._downloadHistory.shift();
        }

        if (this._uploadHistory.length > GRAPH_HISTORY_SECONDS) {
            this._uploadHistory.shift();
        }

        if (this._networkGraph) {
            this._networkGraph.queue_repaint();
        }

        this._lastRxBytes = rxBytes;
        this._lastTxBytes = txBytes;
        this._lastSampleTime = now;
    }

    _drawNetworkGraph(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        // Dark translucent graph surface.
        cr.setSourceRGBA(0.04, 0.04, 0.05, 0.55);
        cr.rectangle(0, 0, width, height);
        cr.fill();

        // Subtle horizontal guides.
        cr.setLineWidth(1);
        cr.setSourceRGBA(1, 1, 1, 0.08);

        for (let i = 1; i < 4; i++) {
            const y = (height / 4) * i;

            cr.moveTo(0, y);
            cr.lineTo(width, y);
        }

        cr.stroke();

        if (
            this._downloadHistory.length < 2 &&
            this._uploadHistory.length < 2
        ) {
            return;
        }

        const allValues = this._downloadHistory.concat(
            this._uploadHistory
        );

        // Keep tiny idle traffic visible while still autoscaling
        // upward for downloads and speed tests.
        const maxValue = Math.max(
            1024,
            ...allValues
        );

        this._drawGraphLine(
            cr,
            this._downloadHistory,
            width,
            height,
            maxValue,
            0.54,
            0.89,
            0.20
        );

        this._drawGraphLine(
            cr,
            this._uploadHistory,
            width,
            height,
            maxValue,
            0.72,
            0.35,
            1.00
        );
    }

    _drawGraphLine(
        cr,
        values,
        width,
        height,
        maxValue,
        red,
        green,
        blue
    ) {
        if (values.length < 2) {
            return;
        }

        const padding = 3;
        const graphHeight = height - (padding * 2);

        cr.setLineWidth(2);
        cr.setSourceRGBA(red, green, blue, 0.95);

        for (let i = 0; i < values.length; i++) {
            const x =
                (i / (GRAPH_HISTORY_SECONDS - 1)) * width;

            const normalized =
                Math.min(1, Math.max(0, values[i] / maxValue));

            const y =
                height -
                padding -
                (normalized * graphHeight);

            if (i === 0) {
                cr.moveTo(x, y);
            } else {
                cr.lineTo(x, y);
            }
        }

        cr.stroke();
    }

    _formatRate(bytesPerSecond) {
        const units = ["B/s", "KB/s", "MB/s", "GB/s"];

        let value = Math.max(0, bytesPerSecond);
        let unitIndex = 0;

        while (
            value >= 1024 &&
            unitIndex < units.length - 1
        ) {
            value /= 1024;
            unitIndex++;
        }

        if (unitIndex === 0) {
            return `${Math.round(value)} ${units[unitIndex]}`;
        }

        if (value >= 100) {
            return `${value.toFixed(0)} ${units[unitIndex]}`;
        }

        if (value >= 10) {
            return `${value.toFixed(1)} ${units[unitIndex]}`;
        }

        return `${value.toFixed(2)} ${units[unitIndex]}`;
    }

    _runSpeedTest() {
        if (this._speedTestProcess !== null) {
            return;
        }

        const executable = GLib.find_program_in_path("librespeed-cli");

        if (!executable) {
            this._showMissingSpeedTest();
            return;
        }

        this._setTestingState(true);

        try {
            const args = [
                executable,
                "--json"
            ];

            if (
                this.speedTestServer &&
                this.speedTestServer !== "auto"
            ) {
                args.push(
                    "--server",
                    String(this.speedTestServer)
                );
            }

            this._speedTestProcess = Gio.Subprocess.new(
                args,
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_PIPE
            );

            this._speedTestProcess.communicate_utf8_async(
                null,
                null,
                (process, result) => {
                    if (this._removed) {
                        return;
                    }

                    try {
                        const [
                            success,
                            stdout,
                            stderr
                        ] = process.communicate_utf8_finish(result);

                        if (!success || process.get_exit_status() !== 0) {
                            global.log(
                                `SpeedPup speed test error: ${stderr}`
                            );

                            this._showSpeedTestError(
                                "Speed test failed"
                            );

                            return;
                        }

                        global.log(`SpeedPup LibreSpeed raw JSON: ${stdout}`);

                        const data = JSON.parse(stdout);

                        this._displaySpeedTestResults(data);
                    } catch (error) {
                        global.logError(
                            `SpeedPup speed test failed: ${error}`
                        );

                        this._showSpeedTestError(
                            "Unable to read speed test result"
                        );
                    } finally {
                        this._speedTestProcess = null;
                        this._setTestingState(false);
                    }
                }
            );
        } catch (error) {
            global.logError(
                `SpeedPup could not start speed test: ${error}`
            );

            this._speedTestProcess = null;
            this._setTestingState(false);

            this._showSpeedTestError(
                "Unable to start speed test"
            );
        }
    }

    _displaySpeedTestResults(data) {
        const result = Array.isArray(data) ? data[0] : data;

        if (!result) {
            throw new Error("LibreSpeed returned no results");
        }

        const downloadMbps = Number(result.download);
        const uploadMbps = Number(result.upload);
        const pingMs = Number(result.ping);

        if (
            !Number.isFinite(downloadMbps) ||
            !Number.isFinite(uploadMbps) ||
            !Number.isFinite(pingMs)
        ) {
            throw new Error("LibreSpeed returned invalid result values");
        }

        this._testDownloadLabel.set_text(
            `↓ Download: ${downloadMbps.toFixed(2)} Mbps`
        );

        this._testUploadLabel.set_text(
            `↑ Upload: ${uploadMbps.toFixed(2)} Mbps`
        );

        this._pingLabel.set_text(
            `Ping: ${pingMs.toFixed(1)} ms`
        );

        let serverName = "--";

        if (
            result.server &&
            typeof result.server.name === "string" &&
            result.server.name.trim() !== ""
        ) {
            serverName = result.server.name.trim();
        }

        this._serverLabel.set_text(serverName);
    }

    _setTestingState(testing) {
        this._speedTestButton.set_reactive(!testing);

        if (testing) {
            this._speedTestButtonLabel.set_text(
                "Testing connection..."
            );

            this._testDownloadLabel.set_text(
                "↓ Download: testing..."
            );

            this._testUploadLabel.set_text(
                "↑ Upload: waiting..."
            );

            this._pingLabel.set_text(
                "Ping: measuring..."
            );
        } else {
            this._speedTestButtonLabel.set_text(
                "▶ Run Speed Test"
            );
        }
    }

    _showMissingSpeedTest() {
        this._testDownloadLabel.set_text(
            "librespeed-cli is not installed"
        );

        this._testUploadLabel.set_text(
            "Install package: librespeed-cli"
        );

        this._pingLabel.set_text(
            "Then try again"
        );
    }

    _showSpeedTestError(message) {
        this._testDownloadLabel.set_text(message);
        this._testUploadLabel.set_text(
            "Check Cinnamon logs for details"
        );
        this._pingLabel.set_text("Ping: --");
    }

    _showNetworkError(message) {
        if (this._removed) {
            return;
        }

        this._downloadLabel.set_text(
            `↓ Download: ${message}`
        );

        this._uploadLabel.set_text(
            "↑ Upload: unavailable"
        );
    }

    on_desklet_removed() {
        this._removed = true;

        if (this._timerId !== 0) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }

        if (
            this._speedTestProcess !== null &&
            !this._speedTestProcess.get_if_exited()
        ) {
            this._speedTestProcess.force_exit();
        }

        if (
            this._speedTestButton &&
            this._buttonSignalId
        ) {
            this._speedTestButton.disconnect(
                this._buttonSignalId
            );
        }

        if (
            this._networkGraph &&
            this._graphRepaintSignal
        ) {
            this._networkGraph.disconnect(
                this._graphRepaintSignal
            );
        }

        this._downloadHistory = [];
        this._uploadHistory = [];

        this._speedTestProcess = null;
        this._networkFile = null;

        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }
    }
}

function main(metadata, deskletId) {
    return new SpeedPupDesklet(metadata, deskletId);
}
