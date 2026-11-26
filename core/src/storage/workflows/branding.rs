use super::*;
use cap_fs_ext::DirExt;
use std::{io::Write, path::Path};

fn validate_payload(data: &[u8], favicon: bool) -> CoreResult<()> {
    if data.is_empty() || data.len() as u64 > MAX_IMAGE {
        return Err(invalid());
    }
    let valid = if favicon {
        data.len() >= 30
            && data[..14] == [0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0]
            && u32::from_le_bytes(data[14..18].try_into().map_err(|_| invalid())?) as usize
                == data.len() - 22
            && data[18..22] == [22, 0, 0, 0]
            && data[22..30] == [137, 80, 78, 71, 13, 10, 26, 10]
    } else {
        data.len() >= 12
            && &data[..4] == b"RIFF"
            && &data[8..12] == b"WEBP"
            && u32::from_le_bytes(data[4..8].try_into().map_err(|_| invalid())?) as usize + 8
                == data.len()
    };
    if !valid {
        return Err(invalid());
    }
    Ok(())
}

pub(super) fn publish_bytes(
    request: &Value,
    bytes: &[u8],
    context: &OperationContext,
) -> CoreResult<Value> {
    let lengths = crate::protocol::branding_lengths(request, bytes.len() as u64)?;
    let first_end = lengths[0];
    let second_end = first_end + lengths[1];
    publish_payloads(
        request,
        [
            &bytes[..first_end],
            &bytes[first_end..second_end],
            &bytes[second_end..],
        ],
        context,
    )
}

fn publish_payloads(
    request: &Value,
    payloads: [&[u8]; 3],
    context: &OperationContext,
) -> CoreResult<Value> {
    // Validate every bounded payload before the first filesystem mutation.
    for (index, data) in payloads.iter().enumerate() {
        validate_payload(data, index == 2)?;
    }
    context.check()?;
    let root_path = absolute(string(request, "rootDirectory")?)?;
    if root_path.parent().is_none() {
        return Err(invalid());
    }
    let root = open_absolute(&root_path, true)?;
    let images = descend(
        &root,
        Path::new("images/system"),
        true,
        DirectoryPermissions::Unrestricted,
    )?;
    let images_path = root_path.join("images/system");
    let stage_name = format!(".branding-{}", uuid::Uuid::new_v4());
    create_directory(&root, Path::new(&stage_name))?;
    let stage = root.open_dir_nofollow(&stage_name)?;
    secure_directory(&stage)?;
    let stage_identity = stage.dir_metadata()?;
    let mut staged_files = Vec::with_capacity(3);
    let result = (|| {
        for (index, data) in payloads.iter().enumerate() {
            context.check()?;
            let mut file = create_file(&stage, Path::new(&index.to_string()))?;
            staged_files.push(file.metadata()?);
            file.write_all(data)?;
            file.sync_all()?;
        }
        sync_dir(&stage)?;
        // Validate every destination before the first replacement. A failure
        // after publication begins can leave a subset updated: this is only
        // per-file atomic publication, never a multi-file transaction.
        for (dir, name) in [
            (&images, "logo.webp"),
            (&images, "logo-64.webp"),
            (&root, "favicon.ico"),
        ] {
            match dir.symlink_metadata(name) {
                Ok(metadata) if !metadata.is_file() || metadata.is_symlink() => {
                    return Err(invalid());
                }
                Ok(_) => (),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(error.into()),
            }
        }
        for (index, (dir, name)) in [
            (&images, "logo.webp"),
            (&images, "logo-64.webp"),
            (&root, "favicon.ico"),
        ]
        .into_iter()
        .enumerate()
        {
            assert_location(&root_path, &root)?;
            assert_location(&images_path, &images)?;
            if !same(&stage_identity, &root.symlink_metadata(&stage_name)?) {
                return Err(invalid());
            }
            if !same(
                &staged_files[index],
                &stage.symlink_metadata(index.to_string())?,
            ) {
                return Err(invalid());
            }
            context.check_now()?;
            super::super::recovery::rename_retry(
                &stage,
                Path::new(&index.to_string()),
                dir,
                Path::new(name),
                context,
            )?;
            sync_dir(dir)?;
            sync_dir(&stage)?;
            let published = dir.symlink_metadata(name)?;
            if !same(&staged_files[index], &published)
                || published.len() != payloads[index].len() as u64
            {
                return Err(invalid());
            }
        }
        assert_location(&root_path, &root)?;
        assert_location(&images_path, &images)?;
        Ok(super::super::success())
    })();
    // Clean only entries in our still-owned private staging handle.
    for (index, owned) in staged_files.iter().enumerate() {
        if stage
            .symlink_metadata(index.to_string())
            .is_ok_and(|actual| same(&actual, owned))
        {
            let _ = stage.remove_file(index.to_string());
        }
    }
    drop(stage);
    let cleanup = if root
        .symlink_metadata(&stage_name)
        .is_ok_and(|actual| same(&actual, &stage_identity))
    {
        root.remove_dir(&stage_name)
            .map_err(CoreError::from)
            .and_then(|()| sync_dir(&root))
    } else {
        Err(invalid())
    };
    match result {
        Err(error) => Err(error),
        Ok(value) => {
            cleanup?;
            Ok(value)
        }
    }
}
