{{- define "nbe-dms.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "nbe-dms.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "nbe-dms.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "nbe-dms.labels" -}}
app.kubernetes.io/name: {{ include "nbe-dms.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}
