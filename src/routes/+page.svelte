<script lang="ts">
	// "Right now" home screen — scaffold placeholder.
	// Next: live projection (suggested next sleep, budget remaining) + quick-log.
</script>

<section class="space-y-4">
	<div
		class="rounded-2xl border border-black/10 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]"
	>
		<p class="text-sm font-medium text-indigo-600 dark:text-indigo-400">Right now</p>
		<p class="mt-1 text-2xl font-semibold">Awake</p>
		<p class="mt-1 text-sm opacity-60">Suggested next sleep will appear here.</p>
	</div>

	<div class="grid grid-cols-2 gap-3">
		<button
			class="rounded-xl bg-indigo-600 px-4 py-6 text-base font-semibold text-white active:scale-[0.98]"
		>
			Fell asleep
		</button>
		<button
			class="rounded-xl border border-black/10 px-4 py-6 text-base font-semibold active:scale-[0.98] dark:border-white/15"
		>
			Woke up
		</button>
	</div>

	<p class="pt-2 text-center text-xs opacity-50">
		Scaffold ready. See REQUIREMENTS.md for the build plan.
	</p>
</section>
