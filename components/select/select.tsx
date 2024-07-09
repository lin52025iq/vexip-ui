import { Icon } from '@/components/icon'
import { Input } from '@/components/input'
import { NativeScroll } from '@/components/native-scroll'
import { Option } from '@/components/option'
import { Overflow } from '@/components/overflow'
import { Popper } from '@/components/popper'
import { Tag } from '@/components/tag'
import { Tooltip } from '@/components/tooltip'
import { VirtualList } from '@/components/virtual-list'
import { useFieldStore } from '@/components/form'

import {
  Transition,
  computed,
  defineComponent,
  nextTick,
  onMounted,
  reactive,
  ref,
  renderSlot,
  toRef,
  watch,
  watchEffect
} from 'vue'

import {
  placementWhileList,
  useClickOutside,
  useHover,
  useModifier,
  useMounted,
  usePopper
} from '@vexip-ui/hooks'
import {
  createIconProp,
  createSizeProp,
  createStateProp,
  emitEvent,
  useIcons,
  useLocale,
  useNameHelper,
  useProps
} from '@vexip-ui/config'
import {
  decide,
  getLast,
  getRangeWidth,
  isNull,
  removeArrayItem,
  toAttrValue
} from '@vexip-ui/utils'
import { selectProps } from './props'

import type { InputHTMLAttributes } from 'vue'
import type { InputExposed } from '@/components/input'
import type { PopperExposed } from '@/components/popper'
import type { TooltipExposed } from '@/components/tooltip'
import type { VirtualListExposed } from '@/components/virtual-list'
import type {
  ChangeEvent,
  SelectBaseValue,
  SelectEvent,
  SelectKeyConfig,
  SelectOptionState,
  SelectValue
} from './symbol'

const defaultKeyConfig: Required<SelectKeyConfig> = {
  value: 'value',
  label: 'label',
  disabled: 'disabled',
  divided: 'divided',
  title: 'title',
  group: 'group',
  children: 'children'
}

function isSameValue(newValue: SelectValue, oldValue: SelectValue) {
  const isNewArray = Array.isArray(newValue)
  const isOldArray = Array.isArray(oldValue)

  if (isNewArray !== isOldArray) return false

  if (isNewArray && isOldArray) {
    if (newValue.length !== oldValue.length) return false

    for (let i = 0, len = newValue.length; i < len; ++i) {
      if (newValue[i] !== oldValue[i]) return false
    }

    return true
  }

  if (isNull(newValue)) return isNull(oldValue)

  return newValue === oldValue
}

export default defineComponent({
  name: 'Select',
  props: selectProps,
  emits: ['update:value', 'update:visible', 'update:label'],
  setup(_props, { emit, slots, expose }) {
    const {
      idFor,
      labelId,
      state,
      disabled,
      loading,
      size,
      validateField,
      clearField,
      getFieldValue,
      setFieldValue
    } = useFieldStore<SelectValue>(focus)

    const nh = useNameHelper('select')
    const props = useProps('select', _props, {
      size: createSizeProp(size),
      state: createStateProp(state),
      locale: null,
      visible: {
        default: false,
        static: true
      },
      options: {
        default: () => [],
        static: true
      },
      disabled: () => disabled.value,
      transitionName: () => nh.ns('drop'),
      outsideClose: true,
      placeholder: null,
      prefix: createIconProp(),
      prefixColor: '',
      suffix: createIconProp(),
      suffixColor: '',
      noSuffix: false,
      value: {
        default: () => getFieldValue()!,
        static: true
      },
      multiple: false,
      clearable: false,
      maxListHeight: 300,
      listClass: null,
      placement: {
        default: 'bottom',
        validator: value => placementWhileList.includes(value)
      },
      transfer: false,
      optionCheck: false,
      emptyText: null,
      staticSuffix: false,
      loading: () => loading.value,
      loadingIcon: createIconProp(),
      loadingLock: false,
      loadingEffect: null,
      keyConfig: () => ({}),
      filter: false,
      ignoreCase: false,
      creatable: false,
      transparent: false,
      maxTagCount: 0,
      noRestTip: false,
      tagType: null,
      noPreview: true,
      remote: false,
      fitPopper: false,
      name: {
        default: '',
        static: true
      },
      popperAlive: null,
      countLimit: 0,
      filterPosition: 'in-control'
    })

    const locale = useLocale('select', toRef(props, 'locale'))
    const icons = useIcons()

    const currentVisible = ref(props.visible)
    const currentLabels = ref<string[]>([])
    const currentValues = ref<SelectBaseValue[]>([])
    const currentIndex = ref(-1)
    const placement = toRef(props, 'placement')
    const transfer = toRef(props, 'transfer')
    // const listHeight = ref<string>()
    const baseOptions = ref<SelectOptionState[]>([])
    const currentFilter = ref('')
    const anchorWidth = ref(0)
    const userOptions = ref<SelectOptionState[]>([])
    const restTagCount = ref(0)
    const restTipShow = ref(false)
    const composing = ref(false)

    const { isMounted } = useMounted()

    const dynamicOption = reactive<SelectOptionState>({
      disabled: false,
      divided: false,
      title: '',
      value: '',
      label: '',
      group: false,
      depth: 0,
      parent: null,
      hidden: false,
      hitting: true,
      data: ''
    })

    const optionValues = reactive(new Set<string | number>())
    const hittingOption = ref<SelectOptionState>()
    const optionStates = computed(() => userOptions.value.concat(baseOptions.value))
    const visibleOptions = computed(() => optionStates.value.filter(state => !state.hidden))

    const keyConfig = computed(() => ({ ...defaultKeyConfig, ...props.keyConfig }))

    const wrapper = useClickOutside(handleClickOutside)
    const nativeInput = ref<HTMLInputElement>()
    const filterInput = ref<InputExposed>()
    const device = ref<HTMLElement>()
    const virtualList = ref<VirtualListExposed>()
    const popper = ref<PopperExposed>()
    const restTip = ref<TooltipExposed>()

    const input = computed(() => filterInput.value?.input ?? nativeInput.value)

    const { reference, transferTo, updatePopper } = usePopper({
      placement,
      transfer,
      wrapper,
      popper: computed(() => popper.value?.wrapper),
      isDrop: true
    })
    const { isHover } = useHover(reference)

    const cachedSelected = reactive(new Map<SelectBaseValue, SelectOptionState>())
    const optionValueMap = ref(new Map<SelectBaseValue, SelectOptionState>())

    let emittedValue: typeof props.value | null = props.value

    const updateTrigger = ref(0)

    watchEffect(() => {
      /* eslint-disable @typescript-eslint/no-unused-expressions */
      props.keyConfig.value
      props.keyConfig.label
      props.keyConfig.disabled
      props.keyConfig.divided
      props.keyConfig.title
      props.keyConfig.group
      props.keyConfig.children

      // If we only read the `props.options`, when user use Array native methods to
      // change options, Vue will not trigger the watch callback
      for (let i = 0, len = props.options.length; i < len; ++i) {
        props.options[i]
      }
      /* eslint-enable */

      updateTrigger.value++
    })

    watch(updateTrigger, initOptionState, { immediate: true })

    function initOptionState() {
      const {
        value: valueKey,
        label: labelKey,
        disabled: disabledKey,
        divided: dividedKey,
        title: titleKey,
        group: groupKey,
        children: childrenKey
      } = keyConfig.value
      const oldMap = optionValueMap.value
      const map = new Map<string | number, SelectOptionState>()
      const states: SelectOptionState[] = []
      const loop = props.options
        .map(option => ({ option, depth: 0, parent: null as SelectOptionState | null }))
        .reverse()

      optionValues.clear()

      for (const option of userOptions.value) {
        map.set(option.value, option)
        optionValues.add(option.value)
      }

      while (loop.length) {
        const { option, depth, parent } = loop.pop()!
        const rawOption = typeof option === 'string' ? { [valueKey]: option } : option
        const group = !!rawOption[groupKey]
        const value = rawOption[valueKey]

        if (!group && isNull(value)) continue

        const label = rawOption[labelKey] || String(value)
        const {
          [disabledKey]: disabled = false,
          [dividedKey]: divided = false,
          [titleKey]: title = '',
          [childrenKey]: children = null
        } = rawOption
        const oldState = oldMap.get(rawOption.value)
        const optionState = reactive({
          disabled,
          divided,
          title,
          value,
          label,
          group,
          depth,
          parent,
          hidden: oldState?.hidden ?? false,
          hitting: oldState?.hitting ?? false,
          data: option
        }) as SelectOptionState

        states.push(optionState)

        if (!group) {
          map.set(value, optionState)
          optionValues.add(String(value))
        }

        if (Array.isArray(children) && children.length) {
          loop.push(
            ...children
              .map(child => {
                return { option: child, depth: depth + 1, parent: optionState }
              })
              .reverse()
          )
        }
      }

      optionValueMap.value = map
      baseOptions.value = states

      initValueAndLabel(emittedValue)
    }

    useModifier({
      target: wrapper,
      passive: false,
      onKeyDown: (event, modifier) => {
        if (composing.value) {
          event.stopPropagation()
          return
        }

        if (!currentVisible.value) {
          if (modifier.space || modifier.enter) {
            event.preventDefault()
            event.stopPropagation()
            toggleVisible()
          }

          return
        }

        if (modifier.tab || modifier.escape) {
          setVisible(false)
          modifier.resetAll()

          return
        }

        decide(
          [
            [
              () => modifier.up || modifier.down,
              () => {
                const options = visibleOptions.value
                const length = options.length

                if (!length) return

                const step = modifier.down ? 1 : -1

                let index = (Math.max(-1, currentIndex.value + step) + length) % length
                let option = options[index]

                for (let i = 0; (option.disabled || option.group) && i < length; ++i) {
                  index += step
                  index = (index + length) % length
                  option = options[index]
                }

                updateHitting(index)
              }
            ],
            [
              () => modifier.enter || (!props.filter && modifier.space),
              () => {
                if (currentIndex.value >= 0) {
                  handleSelect(totalOptions.value[currentIndex.value])
                } else if (showDynamic.value) {
                  handleSelect(dynamicOption)
                } else {
                  setVisible(false)
                }
              }
            ]
          ],
          {
            beforeMatchAny: () => {
              event.preventDefault()
              event.stopPropagation()
            },
            afterMatchAny: modifier.resetAll
          }
        )
      }
    })

    const className = computed(() => {
      return {
        [nh.b()]: true,
        [nh.ns('input-vars')]: true,
        [nh.bs('vars')]: true,
        [nh.bm('inherit')]: props.inherit,
        [nh.bm('multiple')]: props.multiple,
        [nh.bm('filter')]: props.filter,
        [nh.bm('responsive')]: props.multiple && props.maxTagCount <= 0,
        [nh.bm('disabled')]: props.disabled
      }
    })
    const readonly = computed(() => props.loading && props.loadingLock)
    const hasPrefix = computed(() => !!(slots.prefix || props.prefix))
    const selectorClass = computed(() => {
      const baseCls = nh.be('selector')

      return {
        [baseCls]: true,
        [`${baseCls}--focused`]: !props.disabled && currentVisible.value,
        [`${baseCls}--disabled`]: props.disabled,
        [`${baseCls}--readonly`]: readonly.value,
        [`${baseCls}--loading`]: props.loading,
        [`${baseCls}--${props.size}`]: props.size !== 'default',
        [`${baseCls}--${props.state}`]: props.state !== 'default',
        [`${baseCls}--has-prefix`]: hasPrefix.value,
        [`${baseCls}--has-suffix`]: !props.noSuffix,
        [`${baseCls}--transparent`]: props.transparent
      }
    })
    const hasValue = computed(() => !isNull(currentValues.value[0]))
    const showDynamic = computed(() => {
      return !!(
        props.filter &&
        props.creatable &&
        dynamicOption.value &&
        !optionValues.has(dynamicOption.value)
      )
    })
    const totalOptions = computed(() => {
      return showDynamic.value ? [dynamicOption].concat(visibleOptions.value) : visibleOptions.value
    })
    const normalOptions = computed(() => optionStates.value.filter(option => !option.group))
    const optionParentMap = computed(() => {
      const options = normalOptions.value
      const map = new Map<string | number, SelectOptionState>()

      for (let i = 0, len = options.length; i < len; ++i) {
        const option = options[i]

        if (option.parent) {
          map.set(option.value, option.parent)
        }
      }

      return map
    })
    const showClear = computed(() => {
      return (
        !props.disabled && !readonly.value && props.clearable && isHover.value && hasValue.value
      )
    })
    const previewOption = computed(() => {
      return !props.noPreview && currentVisible.value ? hittingOption.value : undefined
    })
    const limited = computed(() => {
      return (
        props.multiple && props.countLimit > 0 && currentValues.value.length >= props.countLimit
      )
    })
    const showPlaceholder = computed(() => {
      if (props.filterPosition !== 'in-control') {
        return (
          !hasValue.value &&
          !previewOption.value &&
          !!(props.placeholder ?? locale.value.placeholder)
        )
      }

      // 采用反推，出现下列情况时不显示：
      // 1. 开始组合（如输入了任意拼音）
      // 2. 有值且 未开预览/多选模式/未打开列表
      // 3. 没有预览选项且没有合法的占位值
      // 4. 打开列表且输入了过滤值
      return (
        !composing.value &&
        !(hasValue.value && (props.noPreview || props.multiple || !currentVisible.value)) &&
        !(!previewOption.value && !(props.placeholder ?? locale.value.placeholder)) &&
        !(currentVisible.value && currentFilter.value)
      )
    })

    function getOptionFromMap(value?: SelectBaseValue | null) {
      if (isNull(value)) return null

      return optionValueMap.value.get(value) ?? cachedSelected.get(value) ?? null
    }

    function fitPopperWidth() {
      requestAnimationFrame(() => {
        updatePopper()

        if (wrapper.value && popper.value?.wrapper) {
          if (typeof props.fitPopper === 'number') {
            popper.value.wrapper.style.width = `${props.fitPopper}px`
          } else if (props.fitPopper) {
            popper.value.wrapper.style.width = `${wrapper.value.offsetWidth}px`
          } else {
            popper.value.wrapper.style.minWidth = `${wrapper.value.offsetWidth}px`
          }
        }
      })
    }

    watch(
      () => props.visible,
      value => {
        currentVisible.value = value
      }
    )
    watch(currentVisible, value => {
      if (value) {
        restTipShow.value = false
        initHittingIndex()
        fitPopperWidth()
      }

      nextTick(syncInputValue)
    })
    watch(
      () => props.value,
      value => {
        if (!emittedValue || !isSameValue(value, emittedValue)) {
          emittedValue = value
          initValueAndLabel(value)
          syncInputValue()
        }
      }
    )
    watch(
      () => props.disabled,
      value => {
        if (value) {
          setVisible(false)
        }
      }
    )
    watch(readonly, value => {
      if (value) {
        setVisible(false)
      }
    })
    watch(currentFilter, value => {
      dynamicOption.value = value
      dynamicOption.label = value
      dynamicOption.data = value

      filterOptions(value)
    })

    onMounted(() => {
      syncInputValue()

      if (props.visible) {
        restTipShow.value = false
        initHittingIndex()
        fitPopperWidth()
      }
    })

    function initValueAndLabel(value: SelectValue | null) {
      if (isNull(value)) {
        currentValues.value = []
        currentLabels.value = []
        return
      }

      const normalizedValue = !Array.isArray(value) ? [value] : value

      const valueSet = new Set(normalizedValue)
      const selectedValues: SelectBaseValue[] = []
      const selectedLabels: string[] = []

      valueSet.forEach(value => {
        let option = getOptionFromMap(value)

        if (option) {
          selectedValues.push(option.value)
          selectedLabels.push(option.label)

          if (!cachedSelected.has(option.value)) {
            cachedSelected.set(option.value, option)
          }
        } else if (props.remote) {
          option = reactive({
            value,
            disabled: false,
            divided: false,
            title: '',
            label: String(value),
            group: false,
            depth: -1,
            parent: null,
            hidden: true,
            hitting: false,
            data: value
          }) as SelectOptionState

          cachedSelected.set(value, option)
          selectedValues.push(value)
          selectedLabels.push(option.label)
        }
      })

      for (const cachedValue of Array.from(cachedSelected.keys())) {
        if (!valueSet.has(cachedValue)) {
          cachedSelected.delete(cachedValue)
        }
      }

      currentValues.value = selectedValues
      currentLabels.value = selectedLabels

      initHittingIndex()
      filterOptions(currentFilter.value)
    }

    function initHittingIndex() {
      const value = currentValues.value[0]

      if (isNull(value)) {
        updateHitting(-1)
      } else {
        if (!isMounted.value) return

        updateHitting(visibleOptions.value.findIndex(option => option.value === value))
      }
    }

    function setVisible(visible: boolean) {
      if (currentVisible.value === visible) return

      currentVisible.value = visible

      emit('update:visible', visible)
      emitEvent(props.onToggle, visible)
    }

    function updateHitting(hitting: number, ensureInView = true) {
      currentIndex.value = hitting
      hittingOption.value = undefined

      let index = -1

      optionStates.value.forEach(option => {
        if (!option.hidden) {
          index += 1
          option.hitting = hitting === index

          if (option.hitting) {
            hittingOption.value = option
          }
        } else {
          option.hitting = false
        }
      })

      if (ensureInView && currentVisible.value && virtualList.value) {
        virtualList.value.ensureIndexInView(hitting)
      }
    }

    function isSelected(option: SelectOptionState) {
      if (props.multiple) {
        return currentValues.value.includes(option.value)
      }

      return currentValues.value[0] === option.value
    }

    function filterOptions(inputValue: string) {
      const filter = props.filter

      if (!filter || props.remote) return

      if (!inputValue) {
        optionStates.value.forEach(state => {
          state.hidden = false
        })
      } else {
        optionStates.value.forEach(state => {
          state.hidden = true
        })

        if (typeof filter === 'function') {
          normalOptions.value.forEach(state => {
            state.hidden = !filter(inputValue, state)
          })
        } else {
          if (props.ignoreCase) {
            const ignoreCaseValue = inputValue.toString().toLocaleLowerCase()

            normalOptions.value.forEach(state => {
              state.hidden = !state.label?.toString().toLocaleLowerCase().includes(ignoreCaseValue)
            })
          } else {
            normalOptions.value.forEach(state => {
              state.hidden = !state.label?.toString().includes(inputValue?.toString())
            })
          }
        }

        const parentMap = optionParentMap.value

        normalOptions.value.forEach(option => {
          if (!option.hidden && option.parent) {
            let parent = parentMap.get(option.value) || null

            while (parent && parent.hidden) {
              parent.hidden = false
              parent = parent.parent
            }
          }
        })
      }

      updateHitting(currentIndex.value)
    }

    function handleTagClose(value?: SelectBaseValue | null) {
      if (props.disabled || readonly.value) return

      !isNull(value) && handleSelect(getOptionFromMap(value))
    }

    function handleRestTagClose(value?: SelectBaseValue | null) {
      handleTagClose(value)

      if (restTipShow.value) {
        restTip.value?.updatePopper()
      }
    }

    function handleSelect(option?: SelectOptionState | null) {
      if (!option) return

      const selected = isSelected(option)
      const value = option.value

      if (selected) {
        if (userOptions.value.find(item => item.value === value)) {
          removeArrayItem(userOptions.value, item => item.value === value)
          optionValueMap.value.delete(value)
        }

        cachedSelected.delete(value)
      } else {
        if (!props.multiple) {
          userOptions.value.length = 0
        }

        if (limited.value) return

        if (dynamicOption.value && value === dynamicOption.value) {
          const newOption = { ...dynamicOption }

          userOptions.value.push(newOption)
          optionValueMap.value.set(value, newOption)
        }

        cachedSelected.set(option.value, option)
      }

      emitEvent(
        props[props.multiple && selected ? 'onCancel' : 'onSelect'] as SelectEvent,
        value,
        option.data
      )
      handleChange(option)

      if (props.multiple) {
        if (props.filterPosition === 'in-control') {
          currentFilter.value = ''
          syncInputValue()
        }

        requestAnimationFrame(updatePopper)
      } else {
        setVisible(false)
      }

      anchorWidth.value = 0
    }

    function handleChange(option: SelectOptionState) {
      if (props.multiple) {
        if (isSelected(option)) {
          const index = currentValues.value.findIndex(v => v === option.value)

          if (~index) {
            currentValues.value.splice(index, 1)
            currentLabels.value.splice(index, 1)
          }
        } else {
          currentValues.value.push(option.value)
          currentLabels.value.push(option.label)
        }

        emittedValue = Array.from(currentValues.value)

        emit('update:value', emittedValue)
        emit('update:label', currentLabels.value)
        setFieldValue(emittedValue)
        emitEvent(
          props.onChange as ChangeEvent,
          emittedValue,
          emittedValue.map(value => getOptionFromMap(value)?.data ?? value)
        )
        validateField()
      } else {
        const prevValue = currentValues.value[0]

        currentValues.value.length = 0
        currentLabels.value.length = 0
        currentValues.value.push(option.value)
        currentLabels.value.push(option.label)

        if (prevValue !== option.value) {
          emittedValue = option.value

          emit('update:value', emittedValue)
          emit('update:label', currentLabels.value[0])
          setFieldValue(emittedValue)
          emitEvent(props.onChange as ChangeEvent, emittedValue, option.data)
          validateField()
        }
      }
    }

    function toggleVisible(event?: Event) {
      event?.stopPropagation()

      if (props.disabled || readonly.value) return

      setVisible(!currentVisible.value)
    }

    function handleClickOutside() {
      restTipShow.value = false
      emitEvent(props.onClickOutside)

      if (props.outsideClose && currentVisible.value) {
        setVisible(false)
        emitEvent(props.onOutsideClose)
      }
    }

    function handleClear(event?: MouseEvent) {
      event?.stopPropagation()

      if (props.disabled || readonly.value) return

      if (props.clearable) {
        for (const option of userOptions.value) {
          optionValueMap.value.delete(option.value)
        }

        cachedSelected.clear()

        userOptions.value.length = 0
        currentValues.value.length = 0
        currentLabels.value.length = 0
        restTipShow.value = false

        emittedValue = props.multiple ? [] : ''

        syncInputValue()
        emit('update:value', emittedValue)
        emitEvent(props.onChange as ChangeEvent, emittedValue, props.multiple ? [] : '')
        emitEvent(props.onClear)
        clearField(emittedValue!)
        updatePopper()
      }
    }

    let focused = false

    function handleFocus(event: FocusEvent) {
      if (!focused) {
        focused = true
        emitEvent(props.onFocus, event)
      }
    }

    function handleBlur(event: FocusEvent) {
      if (focused) {
        focused = false

        setTimeout(() => {
          if (!focused) {
            emitEvent(props.onBlur, event)
          }
        }, 120)
      }
    }

    function syncInputValue() {
      if (!input.value) return

      const visible = currentVisible.value

      if (props.multiple) {
        input.value.value = ''
      } else {
        input.value.value = visible ? '' : currentLabels.value[0] || ''
      }

      visible ? input.value.focus() : input.value.blur()
    }

    function handleFilterInput() {
      if (!input.value || composing.value) return

      let hittingIndex: number

      currentFilter.value = input.value.value

      if (!currentFilter.value) {
        hittingIndex = -1
      } else if (showDynamic.value || currentIndex.value !== -1) {
        hittingIndex = 0
      } else {
        hittingIndex = visibleOptions.value.findIndex(
          option => String(option.label) === currentFilter.value
        )
        hittingIndex = hittingIndex === -1 ? 0 : hittingIndex
      }

      requestAnimationFrame(() => {
        if (!hittingIndex) {
          hittingIndex = visibleOptions.value.findIndex(
            option => !currentValues.value.includes(option.value)
          )
        }

        if (hittingIndex !== currentIndex.value) {
          updateHitting(hittingIndex)
        }

        if (props.multiple && device.value) {
          anchorWidth.value = getRangeWidth(device.value)
        }

        updatePopper()
      })

      emitEvent(props.onFilterInput, currentFilter.value)
    }

    function handleCompositionEnd() {
      if (!composing.value) return

      composing.value = false

      if (input.value) {
        input.value.dispatchEvent(new Event('input'))
      }
    }

    function handleFilterKeyDown(event: KeyboardEvent) {
      if (!input.value) return

      if (
        event.key === 'Backspace' &&
        !input.value.value &&
        !isNull(getLast(currentValues.value))
      ) {
        event.stopPropagation()
        handleTagClose(getLast(currentValues.value))
      }
    }

    function toggleShowRestTip(event?: Event) {
      event?.stopPropagation()

      if (!currentVisible.value) {
        restTipShow.value = !restTipShow.value

        if (restTipShow.value) {
          nextTick(() => {
            restTip.value?.updatePopper()
          })
        }
      } else {
        toggleVisible()
        restTipShow.value = false
      }
    }

    function focus(options?: FocusOptions) {
      if (currentVisible.value) {
        ;(input.value || reference.value)?.focus(options)
      } else {
        reference.value?.focus(options)
      }
    }

    expose({
      idFor,
      labelId,
      currentVisible,
      currentValues,
      currentLabels,
      optionStates,
      isHover,
      currentFilter,
      composing,
      visibleOptions,
      totalOptions,

      wrapper,
      reference,
      popper,
      input,
      device,
      virtualList,
      restTip,

      isSelected,
      getOptionFromMap,
      updateHitting,
      handleClear,
      focus,
      blur: () => {
        input.value?.blur()
        reference.value?.blur()
      }
    })

    function renderFilterInput(attrs: InputHTMLAttributes = {}) {
      return (
        <input
          {...attrs}
          ref={nativeInput}
          class={[nh.be('input'), attrs.class, currentVisible.value && nh.bem('input', 'visible')]}
          disabled={props.disabled}
          autocomplete={'off'}
          tabindex={-1}
          role={'combobox'}
          aria-autocomplete={'list'}
          name={props.name}
          onSubmit={e => e.preventDefault()}
          onInput={handleFilterInput}
          onKeydown={handleFilterKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onCompositionstart={() => (composing.value = true)}
          onCompositionend={handleCompositionEnd}
          onChange={handleCompositionEnd}
        />
      )
    }

    function renderLabel(value: SelectBaseValue, index: number) {
      return (
        <span class={nh.be('label')}>
          {renderSlot(slots, 'selected', { option: getOptionFromMap(value) }, () => [
            currentLabels.value[index]
          ])}
        </span>
      )
    }

    function renderSingleSelected() {
      const option = getOptionFromMap(currentValues.value[0])

      return (
        <span
          class={{
            [nh.be('selected')]: true,
            [nh.bem('selected', 'placeholder')]:
              props.filter && currentVisible.value && hasValue.value
          }}
        >
          {option
            ? renderSlot(slots, 'selected', { option }, () => [currentLabels.value[0]])
            : currentLabels.value[0]}
        </span>
      )
    }

    function renderSingleControl() {
      return (
        <>
          {props.filter &&
            props.filterPosition === 'in-control' &&
            renderFilterInput({ style: { opacity: currentVisible.value ? undefined : '0%' } })}
          {(props.noPreview || !currentVisible.value) &&
            hasValue &&
            (props.filterPosition !== 'in-control' || !currentFilter.value) &&
            renderSingleSelected()}
        </>
      )
    }

    function renderMultipleControl() {
      return (
        <>
          <Overflow
            inherit
            class={[nh.be('tags')]}
            items={currentValues.value}
            max-count={props.maxTagCount}
            style={{
              maxWidth: props.maxTagCount <= 0 && `calc(100% - ${anchorWidth.value}px)`
            }}
            onRestChange={(count: number) => (restTagCount.value = count)}
          >
            {{
              default: ({ item: value, index }: { item: SelectBaseValue, index: number }) => (
                <Tag
                  inherit
                  class={nh.be('tag')}
                  type={props.tagType}
                  closable
                  disabled={props.disabled}
                  onClick={toggleVisible}
                  onClose={() => handleTagClose(value)}
                >
                  {renderLabel(value, index)}
                </Tag>
              ),
              count: ({ count }: { count: number }) =>
                props.noRestTip ? (
                  <Tag
                    inherit
                    class={[nh.be('tag'), nh.be('counter')]}
                    type={props.tagType}
                    disabled={props.disabled}
                    onClick={toggleVisible}
                  >
                    {`+${count}`}
                  </Tag>
                ) : (
                  <Tooltip
                    ref={restTip}
                    inherit
                    transfer={false}
                    visible={restTipShow.value}
                    trigger={'custom'}
                    placement={'top-end'}
                    tip-class={nh.be('rest-tip')}
                    onClick={toggleShowRestTip}
                  >
                    {{
                      trigger: () => (
                        <Tag
                          inherit
                          class={[nh.be('tag'), nh.be('counter')]}
                          type={props.tagType}
                          disabled={props.disabled}
                        >
                          {`+${count}`}
                        </Tag>
                      ),
                      default: () => (
                        <NativeScroll inherit use-y-bar>
                          {currentValues.value.map((value, index) =>
                            index >= currentValues.value.length - restTagCount.value ? (
                              <Tag
                                inherit
                                class={nh.be('tag')}
                                closable
                                type={props.tagType}
                                disabled={props.disabled}
                                onClose={() => handleRestTagClose(value)}
                              >
                                {renderLabel(value, index)}
                              </Tag>
                            ) : null
                          )}
                        </NativeScroll>
                      )
                    }}
                  </Tooltip>
                )
            }}
          </Overflow>
          {props.filter && props.filterPosition === 'in-control' && (
            <div class={nh.be('anchor')} style={{ width: `${anchorWidth.value}px` }}>
              {renderFilterInput({ class: nh.bem('input', 'multiple') })}
              <span ref={device} class={nh.be('device')} aria-hidden>
                {{ currentFilter }}
              </span>
            </div>
          )}
        </>
      )
    }

    function renderPlaceholder() {
      if (!showPlaceholder.value) return null

      return (
        <span class={nh.be('placeholder')}>
          {previewOption.value
            ? renderSlot(slots, 'selected', { option: previewOption.value, preview: true })
            : props.placeholder ?? locale.value.placeholder}
        </span>
      )
    }

    function renderClearOrLoading() {
      return (
        <Transition name={nh.ns('fade')} appear>
          {showClear.value ? (
            <button
              class={[nh.be('icon'), nh.be('clear')]}
              type={'button'}
              tabindex={-1}
              aria-label={locale.value.ariaLabel.clear}
              onClick={handleClear}
            >
              <Icon {...icons.value.clear} label={locale.value.ariaLabel.clear}></Icon>
            </button>
          ) : props.loading ? (
            <div class={[nh.be('icon'), nh.be('loading')]}>
              <Icon
                {...icons.value.loading}
                effect={props.loadingEffect || icons.value.loading.effect}
                icon={props.loadingIcon || icons.value.loading.icon}
                label={'loading'}
              ></Icon>
            </div>
          ) : null}
        </Transition>
      )
    }

    function renderVirtualList() {
      return (
        <VirtualList
          ref={virtualList}
          inherit
          style={{
            height: undefined,
            maxHeight: `${props.maxListHeight}px`
          }}
          items={totalOptions.value}
          item-size={32}
          use-y-bar
          height={'100%'}
          id-key={'value'}
          items-attrs={{
            class: [nh.be('options'), props.optionCheck ? nh.bem('options', 'has-check') : ''],
            role: 'listbox',
            ariaLabel: 'options',
            ariaMultiselectable: props.multiple
          }}
        >
          {{
            default: ({ item: option, index }: { item: SelectOptionState, index: number }) => {
              if (option.group) {
                return (
                  <li class={[nh.ns('option-vars'), nh.be('group')]} title={option.label}>
                    {renderSlot(slots, 'group', { option, index }, () => [
                      <div
                        class={[nh.be('label'), nh.bem('label', 'group')]}
                        style={{ paddingInlineStart: `${option.depth * 6}px` }}
                      >
                        {option.label}
                      </div>
                    ])}
                  </li>
                )
              }

              const selected = isSelected(option)

              return (
                <Option
                  label={option.label}
                  value={option.value}
                  disabled={option.disabled || (limited.value && !selected)}
                  divided={option.divided}
                  no-title={option.title}
                  hitting={option.hitting}
                  selected={selected}
                  no-hover
                  onSelect={() => handleSelect(option)}
                  onMousemove={() => updateHitting(index, false)}
                >
                  {renderSlot(slots, 'default', { option, index, selected }, () => [
                    <span
                      class={nh.be('label')}
                      style={{ paddingInlineStart: `${option.depth * 6}px` }}
                    >
                      {option.label}
                    </span>,
                    props.optionCheck && (
                      <Transition name={nh.ns('fade')} appear>
                        {selected && <Icon {...icons.value.check} class={nh.be('check')}></Icon>}
                      </Transition>
                    )
                  ])}
                </Option>
              )
            },
            empty: () => (
              <div class={nh.be('empty')}>
                {renderSlot(slots, 'empty', undefined, () => [
                  props.emptyText ?? locale.value.empty
                ])}
              </div>
            )
          }}
        </VirtualList>
      )
    }

    function renderInListFilter() {
      if (!props.filter) return null

      return (
        <div class={nh.be('filter')}>
          <Input
            ref={filterInput}
            class={nh.be('filter-input')}
            transparent
            disabled={props.disabled}
            placeholder={locale.value.search}
            autocomplete={false}
            tabindex={-1}
            role={'combobox'}
            aria-autocomplete={'list'}
            name={props.name}
            onInput={handleFilterInput}
            onKeydown={handleFilterKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onCompositionstart={() => (composing.value = true)}
            onCompositionend={handleCompositionEnd}
            onChange={handleCompositionEnd}
          >
            {{
              suffix: () => <Icon {...icons.value.search}></Icon>
            }}
          </Input>
        </div>
      )
    }

    function renderPopper() {
      return (
        <Popper
          ref={popper}
          class={[nh.be('popper'), nh.bs('vars')]}
          visible={currentVisible.value}
          to={transferTo.value}
          transition={props.transitionName}
          alive={props.popperAlive ?? !transferTo.value}
          onClick={(e: MouseEvent) => {
            e.stopPropagation()
            focus()
          }}
          onAfterLeave={() => (currentFilter.value = '')}
        >
          {renderSlot(slots, 'list', { options: totalOptions, isSelected, handleSelect }, () => [
            <div
              class={[
                nh.be('list'),
                (slots.prepend || slots.append) && nh.bem('list', 'with-extra'),
                props.listClass
              ]}
            >
              {props.filterPosition === 'in-list' && renderInListFilter()}
              {slots.prepend?.()}
              {renderVirtualList()}
              {slots.append?.()}
            </div>
          ])}
        </Popper>
      )
    }

    return () => (
      <div
        ref={wrapper}
        id={idFor.value}
        class={className.value}
        role={'group'}
        aria-disabled={toAttrValue(props.disabled)}
        aria-expanded={toAttrValue(currentVisible.value)}
        aria-haspopup={'listbox'}
        aria-labelledby={labelId.value}
        onClick={toggleVisible}
      >
        <div
          ref={reference}
          class={selectorClass.value}
          tabindex={0}
          onFocus={handleFocus}
          onBlur={e => (!props.filter || !currentVisible.value) && handleBlur(e)}
        >
          {hasPrefix.value && (
            <div class={[nh.be('icon'), nh.be('prefix')]} style={{ color: props.prefixColor }}>
              {renderSlot(slots, 'prefix', undefined, () => [<Icon icon={props.prefix}></Icon>])}
            </div>
          )}
          <div class={nh.be('control')}>
            {renderSlot(slots, 'control', undefined, () => [
              props.multiple ? renderMultipleControl() : renderSingleControl(),
              renderPlaceholder()
            ])}
          </div>
          {!props.noSuffix ? (
            <div
              class={[nh.be('icon'), nh.be('suffix')]}
              style={{
                color: props.suffixColor,
                opacity: showClear.value || props.loading ? '0%' : ''
              }}
            >
              {renderSlot(slots, 'suffix', undefined, () => [
                props.suffix ? (
                  <Icon
                    icon={props.suffix}
                    class={{
                      [nh.be('arrow')]: !props.staticSuffix
                    }}
                  ></Icon>
                ) : (
                  <Icon {...icons.value.angleDown} class={nh.be('arrow')}></Icon>
                )
              ])}
            </div>
          ) : props.clearable || props.loading ? (
            <div class={[nh.be('icon'), nh.bem('icon', 'placeholder'), nh.be('suffix')]}></div>
          ) : null}
          {renderClearOrLoading()}
        </div>
        {renderPopper()}
      </div>
    )
  }
})
