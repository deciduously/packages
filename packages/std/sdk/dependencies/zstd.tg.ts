import * as std from "../../tangram.ts";

export const metadata = {
	name: "zstd",
	version: "1.5.6",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:4aa8dd1c1115c0fd6b6b66c35c7f6ce7bd58cc1dfd3e4f175b45b39e84b14352";
	const owner = "facebook";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		compressionFormat: "zst",
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = tg.target(async (arg?: Arg) => {
	const { build: build_, env, host: host_, sdk, source: source_ } = arg ?? {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	const install = tg`make install PREFIX=$OUTPUT`;
	const phases = { install };

	const result = std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		buildInTree: true,
		defaultCrossArgs: false,
		env,
		phases: { phases, order: ["prepare", "build", "install"] },
		prefixArg: "none",
		sdk,
		source: sourceDir,
	});

	return result;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export const test = tg.target(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	await std.assert.pkg({
		metadata,
		buildFunction: build,
		libraries: ["zstd"],
		sdk: sdkArg,
	});
	return true;
});
