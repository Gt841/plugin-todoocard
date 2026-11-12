<script lang="ts">
  export let src: string = "";
</script>

<webview
  allowfullscreen
  allowpopups
  style="border:none;width:100%;height:100%;"
  class="fn__flex-column fn__flex fn__flex-1"
  {src}
></webview>