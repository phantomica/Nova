export const agentToolFeature = {
  tools: [{
    type: 'function',
    function: {
      name: 'get_system_information',
      description: 'Get the current date and time from the system clock, including the system timezone and UTC instant, plus read-only system context (OS/version, locale, uptime, and memory). Optionally include current times in up to 10 IANA timezones (for example, Europe/Paris or America/New_York). This does not set timers or alarms.',
      parameters: {
        type: 'object',
        properties: {
          timeZones: {
            type: 'array',
            maxItems: 10,
            items: { type: 'string', description: 'IANA timezone name, for example Europe/Paris.' }
          }
        }
      }
    }
  }],
  enabled: () => true
}
