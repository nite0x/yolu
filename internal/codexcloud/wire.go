package codexcloud

import (
	"encoding/binary"
	"errors"
)

// The native Codex Cloud client mirrors these protobuf fields in its public
// source. Keep transport and field numbers isolated from Yolu's session model.
type message []byte

func (m message) bytes(tag uint64, value []byte) message {
	m = binary.AppendUvarint(m, tag<<3|2)
	m = binary.AppendUvarint(m, uint64(len(value)))
	return append(m, value...)
}

func (m message) text(tag uint64, value string) message {
	if value == "" {
		return m
	}
	return m.bytes(tag, []byte(value))
}

func (m message) number(tag, value uint64) message {
	return binary.AppendUvarint(binary.AppendUvarint(m, tag<<3), value)
}

type field struct {
	tag    uint64
	data   []byte
	number uint64
}

type fields []field

var errProtocol = errors.New("Codex Cloud returned an unsupported response")

func decode(raw []byte) (fields, error) {
	var values fields
	for len(raw) > 0 {
		key, n := binary.Uvarint(raw)
		if n < 1 || key>>3 == 0 {
			return nil, errProtocol
		}
		raw = raw[n:]
		f := field{tag: key >> 3}
		switch key & 7 {
		case 0:
			f.number, n = binary.Uvarint(raw)
			if n < 1 {
				return nil, errProtocol
			}
			raw = raw[n:]
		case 2:
			size, n := binary.Uvarint(raw)
			if n < 1 || size > uint64(len(raw)-n) {
				return nil, errProtocol
			}
			f.data, raw = raw[n:n+int(size)], raw[n+int(size):]
		case 1, 5:
			width := 4
			if key&7 == 1 {
				width = 8
			}
			if len(raw) < width {
				return nil, errProtocol
			}
			raw = raw[width:]
		default:
			return nil, errProtocol
		}
		values = append(values, f)
	}
	return values, nil
}

func (f fields) get(tag uint64) field {
	for i := len(f) - 1; i >= 0; i-- {
		if f[i].tag == tag {
			return f[i]
		}
	}
	return field{}
}

func (f fields) text(tag uint64) string            { return string(f.get(tag).data) }
func (f fields) nested(tag uint64) (fields, error) { return decode(f.get(tag).data) }
