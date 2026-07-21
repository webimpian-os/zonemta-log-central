'use strict';

const { LogCentralClient } = require('@webimpian/log-central-node');

const DEFAULT_EVENTS = {
    queued: true,
    delivered: true,
    deferred: true,
    bounced: true,
    raw: false,
};

module.exports.title = 'Log Central';

module.exports.init = function (app, done) {
    const config = app.config || {};

    let client;

    try {
        client = new LogCentralClient({
            url: config.url,
            token: config.token,
            app: config.app,
            environment: config.environment || 'production',
            channel: config.channel || 'zonemta',
            hostname: config.hostname,
            batchSize: config.batchSize,
            flushInterval: config.flushInterval,
            maxQueue: config.maxQueue,
            fetch: config.fetch,
        });
    } catch (err) {
        if (app.logger && typeof app.logger.error === 'function') {
            app.logger.error('LogCentral', 'plugin disabled: %s', err.message);
        }

        return done();
    }

    app.logCentral = client;

    const events = Object.assign({}, DEFAULT_EVENTS, config.events);

    // A hook that throws breaks ZoneMTA's plugin chain and with it the mail
    // flow, so every handler swallows its own errors and always calls next.
    const safely = handler => (...args) => {
        const next = typeof args[args.length - 1] === 'function' ? args.pop() : null;

        try {
            handler(...args);
        } catch {
            // never disrupt mail flow because of logging
        }

        if (next) {
            next();
        }
    };

    if (events.queued) {
        app.addHook('message:queue', safely((envelope, messageInfo) => {
            const recipients = Array.isArray(envelope.to) ? envelope.to : [];

            client.info(
                `Queued ${envelope.id} from ${envelope.from || '<>'} to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`,
                {
                    id: envelope.id,
                    from: envelope.from,
                    to: recipients,
                    interface: envelope.interface,
                    origin: envelope.origin,
                    transtype: envelope.transtype,
                    subject: messageInfo && messageInfo.subject,
                },
            );
        }));
    }

    if (events.delivered) {
        app.addHook('sender:delivered', safely((delivery, info) => {
            client.info(`Delivered ${delivery.id}.${delivery.seq} to ${delivery.recipient}`, {
                id: delivery.id,
                seq: delivery.seq,
                recipient: delivery.recipient,
                domain: delivery.domain,
                zone: delivery.sendingZone,
                mx: info && (info.mx || info.host),
                response: info && info.response,
            });
        }));
    }

    if (events.deferred) {
        app.addHook('sender:responseError', safely((delivery, connection, err) => {
            const reason = (err && (err.response || err.message)) || 'unknown error';

            client.warning(`Delivery failed for ${delivery.id}.${delivery.seq} to ${delivery.recipient}: ${reason}`, {
                id: delivery.id,
                seq: delivery.seq,
                recipient: delivery.recipient,
                domain: delivery.domain,
                zone: delivery.sendingZone,
                response: err && err.response,
                category: err && err.category,
            });
        }));
    }

    if (events.bounced) {
        app.addHook('queue:bounce', safely(bounce => {
            const recipient = bounce.to || bounce.recipient || 'unknown recipient';

            client.error(`Bounced ${bounce.id}${bounce.seq ? `.${bounce.seq}` : ''} to ${recipient}: ${bounce.response || ''}`, {
                id: bounce.id,
                seq: bounce.seq,
                from: bounce.from,
                to: recipient,
                response: bounce.response,
                category: bounce.category,
                zone: bounce.sendingZone,
            });
        }));
    }

    if (events.raw) {
        app.addHook('log:entry', safely(entry => {
            const message = (entry && (entry.short_message || entry.action)) || 'zonemta log entry';

            client.debug(message, entry || {});
        }));
    }

    done();
};
