export {};

async function main():
  Promise<void> {
  const [jsonFlag] =
    process.argv.slice(2);

  if (
    jsonFlag !== undefined &&
    jsonFlag !== '--json'
  ) {
    throw new Error(
      'Usage: npm run sniper:verify-execution-archives -- [--json]'
    );
  }

  const [
    archiveModule,
    indexModule,
  ] = await Promise.all([
    import(
      './execution-archive.js'
    ),

    import(
      './execution-archive-index.js'
    ),
  ]);

  const errors: string[] =
    [];

  const warnings: string[] =
    [];

  const indexVerification =
    await indexModule
      .verifyExecutionArchiveIndex();

  errors.push(
    ...indexVerification.errors
  );

  const archiveIds =
    await archiveModule
      .listExecutionArchiveIds();

  const indexByPlanInstance =
    new Map(
      indexVerification.entries.map(
        (entry) => [
          entry.planInstanceId,
          entry,
        ]
      )
    );

  for (
    const archiveId of
    archiveIds
  ) {
    try {
      const archive =
        await archiveModule
          .loadExecutionArchive(
            archiveId
          );

      if (!archive) {
        errors.push(
          `Archive ${archiveId} disappeared during verification`
        );

        continue;
      }

      const indexEntry =
        indexByPlanInstance.get(
          archiveId
        );

      if (!indexEntry) {
        warnings.push(
          `Archive ${archiveId} is valid but missing from index`
        );

        continue;
      }

      if (
        indexEntry.archiveSha256 !==
        archive.archiveSha256
      ) {
        errors.push(
          `Archive ${archiveId} hash does not match index`
        );
      }

      if (
        indexEntry.bundleSha256 !==
        archive
          .evidenceBundle
          .bundleSha256
      ) {
        errors.push(
          `Archive ${archiveId} bundle hash does not match index`
        );
      }
    } catch (error) {
      errors.push(
        `Archive ${archiveId} failed verification: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }
  }

  const archiveIdSet =
    new Set(
      archiveIds
    );

  for (
    const entry of
    indexVerification.entries
  ) {
    if (
      !archiveIdSet.has(
        entry.planInstanceId
      )
    ) {
      errors.push(
        `Archive index references missing file ${entry.planInstanceId}`
      );
    }
  }

  const report = {
    ok:
      errors.length === 0 &&
      warnings.length === 0,

    archiveCount:
      archiveIds.length,

    indexEntryCount:
      indexVerification
        .entryCount,

    errors,
    warnings,
  };

  if (jsonFlag === '--json') {
    console.log(
      JSON.stringify(
        report,
        null,
        2
      )
    );
  } else {
    console.log(
      [
        report.ok
          ? 'EXECUTION ARCHIVES VALID'
          : 'EXECUTION ARCHIVES NEED ATTENTION',

        `Archives: ${report.archiveCount}`,
        `IndexEntries: ${report.indexEntryCount}`,
        `Errors: ${errors.length}`,
        `Warnings: ${warnings.length}`,
      ].join(' | ')
    );

    for (
      const error of
      errors
    ) {
      console.error(
        `ERROR: ${error}`
      );
    }

    for (
      const warning of
      warnings
    ) {
      console.warn(
        `WARNING: ${warning}`
      );
    }
  }

  process.exitCode =
    errors.length > 0
      ? 2
      : warnings.length > 0
        ? 1
        : 0;
}

main().catch(
  (error: unknown) => {
    console.error(
      `Archive verification failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 3;
  }
);
