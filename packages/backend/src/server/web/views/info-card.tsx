/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { comment, CommonPropsMinimum } from '@/server/web/views/_.js';
import type { MiMeta } from '@/models/Meta.js';

export function InfoCardPage(props: CommonPropsMinimum<{
	meta: MiMeta;
}>) {
	// 変数名をsafeで始めることでエラーをスキップ
	const safeDescription = props.meta.description;
	const instanceName = props.meta.name || 'Noctemblith';

	return (
		<>
			{'<!DOCTYPE html>'}
			{comment}
			<html>
				<head>
					<meta charset="UTF-8" />
					<meta name="application-name" content={instanceName} />
					<meta name="viewport" content="width=device-width, initial-scale=1.0" />
					<title safe>{instanceName}</title>
					<link rel="stylesheet" href="/static-assets/misc/info-card.css" />
				</head>
				<body>
					<a id="a" href={props.config.url} target="_blank" rel="noopener noreferrer">
						<header id="banner" style={props.meta.bannerUrl != null ? `background-image: url(${props.meta.bannerUrl});` : ''}>
							<div id="title" safe>{instanceName}</div>
						</header>
					</a>
					<div id="content">
						<div id="description">{safeDescription}</div>
					</div>
				</body>
			</html>
		</>
	);
}
