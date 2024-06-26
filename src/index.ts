import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

type CreateEmailCommand = {
	toAddress: string;
	fromAddress: string;
	subject: string;
	htmlBody: string;
	textBody: string;
}

const createSubscriptionEmailCommand = (input: {toAddress: string, fromAddress: string, code: string}) => {
	const { toAddress, fromAddress, code } = input;
	return createEmailCommand({
		fromAddress,
		toAddress,
		subject: `Daily speech topic - Verify your email`,
		htmlBody: `<h3>Speech topic email verification</h3><a href="https://speechtopics.markhamilton.dev/mailinglist/verify?email=${toAddress}&code=${code}">Click here to verify</a><br><br><a href="https://speechtopics.markhamilton.dev">More speech topics</a>&nbsp;or&nbsp;<a href="https://speechtopics.markhamilton.dev/mailinglist/unsubscribe?email=${toAddress}&code=${code}">Unsubscribe</a>`,
		textBody: `Speech topic email verification\n\nNavigate here to verify your email https://speechtopics.markhamilton.dev/subscribe?email=${toAddress}&code=${code}\n\nUnsubscribe: https://speechtopics.markhamilton.dev`
	})
}

const createDailySpeechTopicEmailCommand = (input: {toAddress: string, fromAddress: string, code: string, topic: string}) => {
	const { toAddress, fromAddress, code, topic } = input;
	return createEmailCommand({
		fromAddress,
		toAddress,
		subject: `Daily speech topic`,
		htmlBody: `<h3>Speech topic of the day</h3><p>${topic}</p><a href="https://speechtopics.markhamilton.dev">More speech topics</a>&nbsp;or&nbsp;<a href="https://speechtopics.markhamilton.dev/mailinglist/unsubscribe?email=${toAddress}&code=${code}">Unsubscribe</a>`,
		textBody: `Speech topic of the day\n\n${topic}\n\nMore topics - https://speechtopics.markhamilton.dev\nUnsubscribe - https://speechtopics.markhamilton.dev/mailinglist/unsubscribe?email=${toAddress}&code=${code}`
	})
}

const createEmailCommand = (input: CreateEmailCommand) => {
	const { toAddress, fromAddress, subject, htmlBody, textBody } = input;
	return new SendEmailCommand({
		Destination: {
			CcAddresses: [],
			ToAddresses: [toAddress],
		},
		Message: {
			Body: {
				Html: {
					Charset: "UTF-8",
					Data: htmlBody,
				},
				Text: {
					Charset: "UTF-8",
					Data: textBody,
				},
			},
			Subject: {
				Charset: "UTF-8",
				Data: subject,
			},
		},
		Source: fromAddress,
		ReplyToAddresses: [],
	});
};


type QueueMessages =
| { type: 'subscribe', email: string, code: string }
| { type: 'dailytopic', email: string, code: string, topic: string }


export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		const row = await env.DB.prepare('select * from MailingList where confirmed = 1').all()
		let request = await fetch('https://speechtopics.markhamilton.dev/api')
		let attempts = 0;

		while (attempts <= 3 && !request.ok) {
			request = await fetch('https://speechtopics.markhamilton.dev/api')
			attempts++;

			if (attempts === 3) {
				return new Response('Failed to fetch topics', { status: 500 });
			}
		}

		const topic = await request.text()

		const results = row.results.map(async (element) => {
			return await env.EMAIL_QUEUE.send({
				type: 'dailytopic',
				email: element.email,
				code: element.code,
				topic: topic
			})}
		);

		ctx.waitUntil(Promise.all(results));
	},
	/*async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { pathname } = new URL(req.url);
		const url = new URL(req.url);

		switch (pathname) {
			case '/subscribe': {
				const email = url.searchParams.get('email');
				const code = url.searchParams.get('code');

				if (!email || !code) {
					return new Response('Missing email or code', { status: 400 });
				}

				await env.EMAIL_QUEUE.send({
					type: 'subscribe',
					email,
					code
				});

				return new Response('Sent message to the queue');
			}
			case '/dailytopic': {
				const email = url.searchParams.get('email');
				const code = url.searchParams.get('code');
				const topic = url.searchParams.get('topic');

				if (!email || !code || !topic) {
					return new Response('Missing email, code or topic', { status: 400 });
				}

				await env.EMAIL_QUEUE.send({
					type: 'dailytopic',
					email,
					code,
					topic
				});

				return new Response('Sent message to the queue');
			}
			default:
				return new Response('Unknown path', { status: 404 });
		}
	},*/

	async queue(batch: MessageBatch<QueueMessages>, env: Env): Promise<void> {
		const sesClient = new SESClient({
			region: env.AWS_REGION,
			credentials: {
				accessKeyId: env.AWS_ACCESS_KEY_ID,
				secretAccessKey: env.AWS_SECRET_ACCESS_KEY
			}
		});

		for (let message of batch.messages) {
			console.log(`${message.timestamp} - attempt ${message.attempts} id ${message.id} processed: ${JSON.stringify(message.body)}`);

			let emailCommand: SendEmailCommand;
			switch (message.body.type) {
				case 'subscribe':
					emailCommand = createSubscriptionEmailCommand({
						fromAddress: env.SMTP_FROM,
						toAddress: message.body.email,
						code: message.body.code
					});
					break;
				case 'dailytopic':
					emailCommand = createDailySpeechTopicEmailCommand({
						fromAddress: env.SMTP_FROM,
						toAddress: message.body.email,
						code: message.body.code,
						topic: message.body.topic
					});
					break;
			}

			try {
				await sesClient.send(emailCommand);
			} catch (e) {
				console.error("Failed to send email.", e);
			}
		}
	},
};
