/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { URL } from 'node:url';
import * as http from 'node:http';
import * as https from 'node:https';
import { Injectable } from '@nestjs/common';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NodeHttpHandler, NodeHttpHandlerOptions } from '@smithy/node-http-handler';
import type { MiMeta } from '@/models/Meta.js';
import { DI } from '@/di-symbols.js';
import { Inject } from '@nestjs/common';
import type { Config } from '@/config.js';
import { assertManafieldObjectStorageTarget } from '@/misc/manafield-object-storage-binding.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { bindThis } from '@/decorators.js';
import type { DeleteObjectCommandInput, PutObjectCommandInput } from '@aws-sdk/client-s3';

@Injectable()
export class S3Service {
	constructor(
		@Inject(DI.config) private config: Config,
		private httpRequestService: HttpRequestService,
	) {
	}

	@bindThis
	public getS3Client(meta: MiMeta): S3Client {
		const bound = this.config.objectStorageBinding;
		const ssl = bound ? true : meta.objectStorageUseSSL;
		const u = bound?.endpointUrl ?? (meta.objectStorageEndpoint
			? `${ssl ? 'https' : 'http'}://${meta.objectStorageEndpoint}`
			: `${ssl ? 'https' : 'http'}://example.net`); // dummy URL for agent selection

		const agent = this.httpRequestService.getAgentByUrl(new URL(u), bound ? true : !meta.objectStorageUseProxy, true);
		const handlerOption: NodeHttpHandlerOptions = {};
		if (ssl) {
			handlerOption.httpsAgent = agent as https.Agent;
		} else {
			handlerOption.httpAgent = agent as http.Agent;
		}

		return new S3Client({
			endpoint: bound ? bound.endpointUrl : (meta.objectStorageEndpoint ? u : undefined),
			// Managed mode reads secrets only from a private mounted file. Never
			// use legacy Meta credentials or persist binding keys in the database.
			credentials: bound ? {
				accessKeyId: bound.accessKeyId,
				secretAccessKey: bound.secretAccessKey,
			} : (meta.objectStorageAccessKey !== null && meta.objectStorageSecretKey !== null) ? {
				accessKeyId: meta.objectStorageAccessKey,
				secretAccessKey: meta.objectStorageSecretKey,
			} : undefined,
			region: bound?.region ?? (meta.objectStorageRegion ? meta.objectStorageRegion : undefined),
			tls: ssl,
			forcePathStyle: bound?.forcePathStyle ?? (meta.objectStorageEndpoint ? meta.objectStorageS3ForcePathStyle : false),
			requestHandler: new NodeHttpHandler(handlerOption),
			requestChecksumCalculation: 'WHEN_REQUIRED',
			responseChecksumValidation: 'WHEN_REQUIRED',
		});
	}

	@bindThis
	public async upload(meta: MiMeta, input: PutObjectCommandInput) {
		assertManafieldObjectStorageTarget(this.config.objectStorageBinding, input.Bucket, input.Key);
		const client = this.getS3Client(meta);
		return new Upload({
			client,
			params: input,
			partSize: (client.config.endpoint && (await client.config.endpoint()).hostname === 'storage.googleapis.com')
				? 500 * 1024 * 1024
				: 8 * 1024 * 1024,
		}).done();
	}

	@bindThis
	public delete(meta: MiMeta, input: DeleteObjectCommandInput) {
		assertManafieldObjectStorageTarget(this.config.objectStorageBinding, input.Bucket, input.Key);
		const client = this.getS3Client(meta);
		return client.send(new DeleteObjectCommand(input));
	}
}
