/* mGBA → WebAssembly shim, multi-instance.
 *
 * Derived from scripts/shim/mgba_shim.c of github.com/wasm-gaming/mGBA-wasm
 * (MPL-2.0), which is single-instance by design: one page, one emulator. The
 * Cable Link needs up to four GBAs in one page, and they have to share an
 * address space, because GBASIOLockstepCoordinator keeps its players in a
 * Table of its own. So the globals become an array and every export takes an
 * instance id.
 *
 * This file stops short of the link: no GBASIOLockstepCoordinator here yet.
 * The milestone it serves is narrower — two mCore in one module, one ROM
 * loaded once, both running the game independently. The link goes in only
 * after that holds.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/core/log.h>
#include <mgba-util/audio-buffer.h>
#include <mgba-util/image.h>
#include <mgba-util/vfs.h>

#include <malloc.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten.h>

#define EXPORT EMSCRIPTEN_KEEPALIVE

/* MAX_GBAS in mgba/internal/gba/sio.h. Four is the cable's own ceiling, so
 * there is no reason for this to be larger. */
#define MGBAWASM_MAX_INSTANCES 4

/* Super Game Boy draws a border around the 160x144 picture, which is the
 * largest output any of these cores produces. Allocated once per instance at
 * this size and handed to the core with a constant stride, so a mid-game
 * resolution change never reallocates. */
#define VIDEO_WIDTH_MAX 256
#define VIDEO_HEIGHT_MAX 224

/* Log levels as the SDK's `options.logLevel` numbers them. */
enum {
	LOG_OFF = 0,
	LOG_ERROR = 1,
	LOG_DEBUG = 2,
};

struct Instance {
	struct mCore* core;

	/* The core's own framebuffer: mColor, which without COLOR_16_BIT is a
	 * uint32 laid out by M_RGB5_TO_BGR8 — bytes R, G, B, 0 in memory. */
	mColor* videoBuffer;
	/* Tightly packed RGBA the caller reads straight into ImageData. */
	uint32_t* rgbaBuffer;

	unsigned videoWidth;
	unsigned videoHeight;

	/* Battery-backed save memory is per instance even when the ROM is shared:
	 * each console has its own cartridge save. */
	void* sramData;
	size_t sramSize;
};

static struct Instance instances[MGBAWASM_MAX_INSTANCES];
static int instanceCount = 0;

/* ---------------------------------------------------------- shared ROM ---
 *
 * In a Link session all consoles run the same cartridge, so the image is
 * copied into the heap once and every instance's VFile is wrapped around that
 * one buffer. Four private copies of a 16 MiB cart would be 64 MiB thrown
 * away, which is the difference between fitting in the 64 MiB initial heap and
 * not.
 *
 * Safe because VFileFromMemory does not take ownership of the memory it wraps,
 * and the cartridge is read-only from the core's point of view: EEPROM and
 * flash live in savedata, which stays per instance.
 *
 * The exception to watch: mGBA maps a few unlicensed/Matrix carts writable.
 * Sharing the buffer across cores would let one console's write reach the
 * others. Commercial carts do not do this, and the library is commercial, but
 * this is why a cart that misbehaves has to fall back to private copies.
 */
static void* sharedRom = NULL;
static size_t sharedRomSize = 0;

static void* sharedBios = NULL;
static size_t sharedBiosSize = 0;

static int logLevel = LOG_ERROR;

/* --------------------------------------------------------------- logging */

static void _log(struct mLogger* logger, int category, enum mLogLevel level, const char* format,
                 va_list args) {
	UNUSED(logger);

	if (logLevel == LOG_OFF) {
		return;
	}
	if (logLevel == LOG_ERROR && !(level & (mLOG_FATAL | mLOG_ERROR | mLOG_WARN))) {
		return;
	}

	char buffer[512];
	vsnprintf(buffer, sizeof(buffer), format, args);
	printf("[mgba:%s] %s\n", mLogCategoryName(category), buffer);
}

static struct mLogger shimLogger = { .log = _log, .filter = NULL };

EXPORT void mgbawasm_set_log_level(int level) {
	logLevel = level;
}

/* ----------------------------------------------------------------- setup */

/** Installs the shim's logger. Safe to call more than once. */
EXPORT void mgbawasm_init(void) {
	mLogSetDefaultLogger(&shimLogger);
}

static struct Instance* _instance(int id) {
	if (id < 0 || id >= MGBAWASM_MAX_INSTANCES) {
		return NULL;
	}
	struct Instance* inst = &instances[id];
	return inst->core ? inst : NULL;
}

/* ------------------------------------------------------------ shared ROM */

/**
 * Copies the cartridge image into a module-owned buffer that every instance
 * will map. Replaces whatever was shared before, so it must be called while no
 * instance is open — an open core holds a VFile pointing into the old bytes.
 *
 * Returns the byte count, or 0 on failure.
 */
EXPORT int mgbawasm_rom_share(const void* rom, int bytes) {
	if (instanceCount > 0) {
		return 0;
	}
	free(sharedRom);
	sharedRom = NULL;
	sharedRomSize = 0;

	if (!rom || bytes <= 0) {
		return 0;
	}
	sharedRom = malloc((size_t) bytes);
	if (!sharedRom) {
		return 0;
	}
	memcpy(sharedRom, rom, (size_t) bytes);
	sharedRomSize = (size_t) bytes;
	return (int) sharedRomSize;
}

/** Optional. mGBA's high-level BIOS covers virtually every commercial title. */
EXPORT int mgbawasm_bios_share(const void* bios, int bytes) {
	if (instanceCount > 0) {
		return 0;
	}
	free(sharedBios);
	sharedBios = NULL;
	sharedBiosSize = 0;

	if (!bios || bytes <= 0) {
		return 0;
	}
	sharedBios = malloc((size_t) bytes);
	if (!sharedBios) {
		return 0;
	}
	memcpy(sharedBios, bios, (size_t) bytes);
	sharedBiosSize = (size_t) bytes;
	return (int) sharedBiosSize;
}

EXPORT void mgbawasm_rom_release(void) {
	if (instanceCount > 0) {
		return;
	}
	free(sharedRom);
	sharedRom = NULL;
	sharedRomSize = 0;
	free(sharedBios);
	sharedBios = NULL;
	sharedBiosSize = 0;
}

EXPORT int mgbawasm_rom_size(void) {
	return (int) sharedRomSize;
}

/* -------------------------------------------------------------- instances */

static void _closeInstance(struct Instance* inst) {
	if (inst->core) {
		inst->core->unloadROM(inst->core);
		mCoreConfigDeinit(&inst->core->config);
		inst->core->deinit(inst->core);
		inst->core = NULL;
		--instanceCount;
	}
	free(inst->videoBuffer);
	inst->videoBuffer = NULL;
	free(inst->rgbaBuffer);
	inst->rgbaBuffer = NULL;
	free(inst->sramData);
	inst->sramData = NULL;
	inst->sramSize = 0;
	inst->videoWidth = 0;
	inst->videoHeight = 0;
}

/**
 * Opens one console on the shared ROM and returns its id, or -1.
 *
 * `platform` is an `enum mPlatform`, or -1 to let mGBA sniff the image.
 * `gbModel` is one of mGBA's `gb.model` names ("DMG", "SGB", "CGB", "AGB"), or
 * NULL to detect it from the header; the GBA core ignores it. Both it and
 * `skipBios` are arguments rather than setters because the core reads them
 * while it maps the cartridge.
 */
EXPORT int mgbawasm_instance_open(int platform, const char* gbModel, int skipBios) {
	if (!sharedRom || !sharedRomSize) {
		return -1;
	}

	int id;
	for (id = 0; id < MGBAWASM_MAX_INSTANCES; ++id) {
		if (!instances[id].core) {
			break;
		}
	}
	if (id == MGBAWASM_MAX_INSTANCES) {
		return -1;
	}
	struct Instance* inst = &instances[id];

	/* One VFile per instance over the one shared buffer. VFileFromMemory does
	 * not copy and does not own, so the instances do not fight over it. */
	struct VFile* romVf = VFileFromMemory(sharedRom, sharedRomSize);
	if (!romVf) {
		return -1;
	}

	if (platform < 0) {
		inst->core = mCoreFindVF(romVf);
	} else {
		inst->core = mCoreCreate((enum mPlatform) platform);
	}
	if (!inst->core) {
		romVf->close(romVf);
		return -1;
	}

	mCoreInitConfig(inst->core, NULL);
	if (!inst->core->init(inst->core)) {
		/* The config is the only thing that got set up, so it is the only thing
		 * to tear down: deinit() on a core that failed init is not safe. */
		romVf->close(romVf);
		mCoreConfigDeinit(&inst->core->config);
		inst->core = NULL;
		return -1;
	}
	++instanceCount;

	/* mCoreInitConfig only creates the tables — it seeds no values, so every
	 * mCoreOptions field starts at zero and a frontend that skips this step
	 * gets `volume = 0`, i.e. a perfectly working emulator that is silent.
	 * These are the same defaults mGBA's own libretro port installs. */
	struct mCoreOptions defaults = {
		.useBios = true,
		.skipBios = skipBios != 0,
		.volume = 0x100,
		.logLevel = mLOG_ALL,
	};
	mCoreConfigLoadDefaults(&inst->core->config, &defaults);

	if (gbModel && gbModel[0]) {
		mCoreConfigSetValue(&inst->core->config, "gb.model", gbModel);
	}

	mCoreLoadConfig(inst->core);

	inst->videoBuffer = calloc(VIDEO_WIDTH_MAX * VIDEO_HEIGHT_MAX, sizeof(mColor));
	inst->rgbaBuffer = calloc(VIDEO_WIDTH_MAX * VIDEO_HEIGHT_MAX, sizeof(uint32_t));
	if (!inst->videoBuffer || !inst->rgbaBuffer) {
		romVf->close(romVf);
		_closeInstance(inst);
		return -1;
	}
	inst->core->setVideoBuffer(inst->core, inst->videoBuffer, VIDEO_WIDTH_MAX);

	/* Sized for the worst case rather than for the rate at reset, because the
	 * GBA rate can double mid-game and a caller only drains once per frame:
	 * 131072 Hz (the Game Boy core) over one frame is ~2200 stereo pairs. The
	 * cap is mGBA's own — its blip buffer does not go past 0x4000. */
	inst->core->setAudioBufferSize(inst->core, 0x4000);

	/* loadROM takes ownership of the VFile on success. */
	if (!inst->core->loadROM(inst->core, romVf)) {
		romVf->close(romVf);
		_closeInstance(inst);
		return -1;
	}

	if (sharedBios && sharedBiosSize) {
		struct VFile* biosVf = VFileFromMemory(sharedBios, sharedBiosSize);
		if (biosVf && !inst->core->loadBIOS(inst->core, biosVf, 0)) {
			biosVf->close(biosVf);
		}
	}

	inst->core->reset(inst->core);
	inst->core->currentVideoSize(inst->core, &inst->videoWidth, &inst->videoHeight);
	return id;
}

EXPORT void mgbawasm_instance_close(int id) {
	if (id < 0 || id >= MGBAWASM_MAX_INSTANCES) {
		return;
	}
	_closeInstance(&instances[id]);
}

EXPORT int mgbawasm_instance_count(void) {
	return instanceCount;
}

EXPORT int mgbawasm_instance_max(void) {
	return MGBAWASM_MAX_INSTANCES;
}

/** `enum mPlatform` of the core that actually got created, or -1. */
EXPORT int mgbawasm_platform(int id) {
	struct Instance* inst = _instance(id);
	return inst ? (int) inst->core->platform(inst->core) : -1;
}

EXPORT void mgbawasm_reset(int id) {
	struct Instance* inst = _instance(id);
	if (inst) {
		inst->core->reset(inst->core);
		inst->core->currentVideoSize(inst->core, &inst->videoWidth, &inst->videoHeight);
	}
}

/** Whether a BIOS image was supplied and accepted for this session. */
EXPORT int mgbawasm_has_bios(void) {
	return sharedBios ? 1 : 0;
}

/* ------------------------------------------------------------------ video */

/**
 * Runs exactly one frame and packs the result.
 *
 * The core writes into `videoBuffer` at a constant `VIDEO_WIDTH_MAX` stride
 * while the visible picture can be anything from 160x144 (Game Boy) to 256x224
 * (Super Game Boy border) to 240x160 (GBA), so this repacks to a tight
 * `width * height` RGBA block and sets the alpha the core leaves at zero.
 */
EXPORT void mgbawasm_run_frame(int id) {
	struct Instance* inst = _instance(id);
	if (!inst) {
		return;
	}

	inst->core->runFrame(inst->core);
	inst->core->currentVideoSize(inst->core, &inst->videoWidth, &inst->videoHeight);

	unsigned width = inst->videoWidth > VIDEO_WIDTH_MAX ? VIDEO_WIDTH_MAX : inst->videoWidth;
	unsigned height = inst->videoHeight > VIDEO_HEIGHT_MAX ? VIDEO_HEIGHT_MAX : inst->videoHeight;

	for (unsigned y = 0; y < height; ++y) {
		const mColor* src = &inst->videoBuffer[y * VIDEO_WIDTH_MAX];
		uint32_t* dst = &inst->rgbaBuffer[y * width];
		for (unsigned x = 0; x < width; ++x) {
			dst[x] = (uint32_t) src[x] | 0xFF000000u;
		}
	}
}

EXPORT void* mgbawasm_video_ptr(int id) {
	struct Instance* inst = _instance(id);
	return inst ? inst->rgbaBuffer : NULL;
}

EXPORT int mgbawasm_video_width(int id) {
	struct Instance* inst = _instance(id);
	return inst ? (int) inst->videoWidth : 0;
}

EXPORT int mgbawasm_video_height(int id) {
	struct Instance* inst = _instance(id);
	return inst ? (int) inst->videoHeight : 0;
}

EXPORT int mgbawasm_frame_counter(int id) {
	struct Instance* inst = _instance(id);
	return inst ? (int) inst->core->frameCounter(inst->core) : 0;
}

/**
 * Frames per second in micro-Hz, so the exact rate survives the trip through
 * an int. The cores derive it from their own clock rather than from a constant.
 */
EXPORT int mgbawasm_framerate_micro(int id) {
	struct Instance* inst = _instance(id);
	if (!inst) {
		return 0;
	}
	int32_t cycles = inst->core->frameCycles(inst->core);
	if (cycles <= 0) {
		return 0;
	}
	return (int) ((double) inst->core->frequency(inst->core) / (double) cycles * 1e6);
}

/* ------------------------------------------------------------------ audio */

EXPORT int mgbawasm_sample_rate(int id) {
	struct Instance* inst = _instance(id);
	return inst ? (int) inst->core->audioSampleRate(inst->core) : 0;
}

/** Frames (stereo pairs) waiting in the core's buffer. */
EXPORT int mgbawasm_audio_available(int id) {
	struct Instance* inst = _instance(id);
	if (!inst) {
		return 0;
	}
	return (int) mAudioBufferAvailable(inst->core->getAudioBuffer(inst->core));
}

/**
 * Drains up to `frames` interleaved stereo pairs into `out`, returning how many
 * were actually read. Short reads are normal — the number of samples a frame
 * produces wobbles around the nominal rate.
 */
EXPORT int mgbawasm_read_audio(int id, int16_t* out, int frames) {
	struct Instance* inst = _instance(id);
	if (!inst || !out || frames <= 0) {
		return 0;
	}
	return (int) mAudioBufferRead(inst->core->getAudioBuffer(inst->core), out, (size_t) frames);
}

/**
 * Throws away whatever the core has queued.
 *
 * Only one console is audible in a Link session; the others still fill their
 * blip buffer every frame, and a buffer nobody drains is a buffer that stops
 * accepting samples. This is how a silent instance stays cheap without
 * pretending to play.
 */
EXPORT int mgbawasm_drop_audio(int id) {
	struct Instance* inst = _instance(id);
	if (!inst) {
		return 0;
	}
	struct mAudioBuffer* buffer = inst->core->getAudioBuffer(inst->core);
	size_t available = mAudioBufferAvailable(buffer);
	if (available) {
		mAudioBufferClear(buffer);
	}
	return (int) available;
}

/* ------------------------------------------------------------------ input */

/**
 * Sets the whole key state at once, as a bitmask of `enum GBAKey`. The Game Boy
 * core numbers its first eight keys identically (A, B, Select, Start, Right,
 * Left, Up, Down), so one mask drives both; the L/R bits are simply ignored
 * when a Game Boy ROM is running.
 */
EXPORT void mgbawasm_set_keys(int id, unsigned keys) {
	struct Instance* inst = _instance(id);
	if (inst) {
		inst->core->setKeys(inst->core, keys);
	}
}

/* ------------------------------------------------------------- savestates */

EXPORT int mgbawasm_state_size(int id) {
	struct Instance* inst = _instance(id);
	return inst ? (int) inst->core->stateSize(inst->core) : 0;
}

EXPORT int mgbawasm_state_save(int id, void* out) {
	struct Instance* inst = _instance(id);
	if (!inst || !out) {
		return 0;
	}
	return inst->core->saveState(inst->core, out) ? 1 : 0;
}

EXPORT int mgbawasm_state_load(int id, const void* in) {
	struct Instance* inst = _instance(id);
	if (!inst || !in) {
		return 0;
	}
	return inst->core->loadState(inst->core, in) ? 1 : 0;
}

/* ------------------------------------------------------------------- SRAM */

/**
 * Snapshots battery-backed save memory into a shim-owned buffer.
 *
 * `savedataClone` mallocs, so the pointer is parked in the instance and freed
 * on the next call — the caller is expected to copy the bytes out before doing
 * anything else. Returns the byte count, or 0 when the cartridge has no
 * savedata (which is not an error: plenty of carts have none).
 */
EXPORT int mgbawasm_sram_save(int id) {
	struct Instance* inst = _instance(id);
	if (!inst) {
		return 0;
	}
	free(inst->sramData);
	inst->sramData = NULL;
	inst->sramSize = inst->core->savedataClone(inst->core, &inst->sramData);
	return (int) inst->sramSize;
}

EXPORT void* mgbawasm_sram_ptr(int id) {
	struct Instance* inst = _instance(id);
	return inst ? inst->sramData : NULL;
}

EXPORT int mgbawasm_sram_load(int id, const void* data, int bytes) {
	struct Instance* inst = _instance(id);
	if (!inst || !data || bytes <= 0) {
		return 0;
	}
	return inst->core->savedataRestore(inst->core, data, (size_t) bytes, true) ? 1 : 0;
}

/* ---------------------------------------------------------------- options */

/*
 * Everything below writes into the core's own `mCoreConfig` and then asks the
 * core to re-read that one key. mGBA is built for this — it is how its Qt
 * frontend applies a settings change to a running game — so these take effect
 * without a reset.
 */

static void _reload(struct Instance* inst, const char* key) {
	if (inst->core->reloadConfigOption) {
		inst->core->reloadConfigOption(inst->core, key, &inst->core->config);
	}
}

/** 0 = ignore, 1 = remove, 2 = detect. */
EXPORT void mgbawasm_set_idle_optimization(int id, int mode) {
	struct Instance* inst = _instance(id);
	if (!inst) {
		return;
	}
	const char* value = mode == 0 ? "ignore" : (mode == 2 ? "detect" : "remove");
	mCoreConfigSetValue(&inst->core->config, "idleOptimization", value);
	_reload(inst, "idleOptimization");
}

EXPORT void mgbawasm_set_allow_opposing_directions(int id, int allow) {
	struct Instance* inst = _instance(id);
	if (!inst) {
		return;
	}
	mCoreConfigSetIntValue(&inst->core->config, "allowOpposingDirections", allow ? 1 : 0);
	_reload(inst, "allowOpposingDirections");
}

/* ------------------------------------------------------------ diagnostics */

/**
 * Bytes currently handed out by malloc, straight from dlmalloc's own
 * accounting. This is what the prototype reports when it compares one console
 * against two: `HEAPU8.length` only shows the reserved linear memory, which
 * ALLOW_MEMORY_GROWTH leaves far larger than what is in use.
 */
EXPORT int mgbawasm_heap_used(void) {
	struct mallinfo info = mallinfo();
	return (int) info.uordblks;
}
